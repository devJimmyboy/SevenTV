import { Constants } from '@typings/src/Constants';
import { DataStructure } from '@typings/typings/DataStructure';
import { Observable, Subject } from 'rxjs';
import { filter, takeUntil, tap } from 'rxjs/operators';
import { Logger } from 'src/Logger';
import { emoteStore } from 'src/Sites/app/SiteApp';
import { TwitchPageScript } from 'src/Sites/twitch.tv/twitch';
import { MessagePatcher } from 'src/Sites/twitch.tv/Util/MessagePatcher';
import { Twitch } from 'src/Sites/twitch.tv/Util/Twitch';

const IsREGEX = new RegExp('\/.*\/[gmiuysd]*');

let currentHandler: (msg: Twitch.ChatMessage) => void;
export class TwitchChatListener {
	/** Create a Twitch instance bound to this listener */
	private twitch = this.page.twitch;

	/** A list of message IDs which have been received but not yet rendered on screen */
	private pendingMessages = new Set<string>();

	linesRendered = 0;

	private killed = new Subject<void>();

	private messageLog: Twitch.ChatMessage[];

	constructor(private page: TwitchPageScript) {
		(window as any).twitch = this.twitch;
		this.messageLog = [];
	}

	start(): void {
		// Detect rerenders
		const listener = this; // Get class context to pass it into the function
		const x = this.twitch.getChatController().componentDidUpdate; // Get current componentDidUpdate()

		if (!this.page.ffzMode) {
			const controller = this.twitch.getChatController();
			if (!!controller) {
				controller.componentDidUpdate = function (a, b) {
					if (listener.page.ffzMode) {
						return;
					}

					Logger.Get().debug(`Twitch chat rerender detected, rendering 7TV emotes`);
					setTimeout(() => listener.rerenderAll(listener.twitch.getChatLines()), 1000); // Rerender all existing chat lines

					if (!!x && typeof x === 'function') {
						try {
							x.apply(this, [a, b]); // Pass the execution on
						} catch (err) {
							console.error(err);
						}
					}
				};

				// Handle kill
				this.killed.subscribe({
					next: () => {
						controller.componentDidUpdate = x;
					}
				});
			}
		}

		// Set up an add chat commands
		this.overrideGrouper();
		this.addCommand(this.commands.nuke);
		this.logMessages();
	}

	listen(): void {
		Logger.Get().info('Listening for chat messages');
		const msgHandler = this.twitch.getChatController().props.messageHandlerAPI;
		if (!!currentHandler) {
			Logger.Get().info('Unloading previous handler');
			msgHandler.removeMessageHandler(currentHandler);
		}

		// Add a handler for regular chat messages
		currentHandler = msg => {
			if (this.page.ffzMode) return undefined;
			if (msg.messageType !== 0 && msg.messageType !== 1) return undefined;

			this.onMessage(msg);
		};
		msgHandler.addMessageHandler(currentHandler);

		// Add a handler for moderation messages
		msgHandler.addMessageHandler(msg => {
			if (msg.type !== 2) return undefined;
			if (!this.page.site.config.get('general.display_mod_actions')?.asBoolean()) {
				return undefined; // Don't emit a mod message, as the setting is disabled
			}
			const modMsg = msg as unknown as Twitch.ChatMessage.ModerationMessage;

			if (modMsg.moderationType === 1) { // Timeout
				this.sendSystemMessage(`${modMsg.userLogin} was timed out for ${modMsg.duration} seconds${!!modMsg.reason ? ` (${modMsg.reason})` : ''} by a moderator`);
			} else if (modMsg.moderationType === 0) { // Ban
				this.sendSystemMessage(`${modMsg.userLogin} was permanently banned by a moderator`);
			} else if (modMsg.moderationType === 2) { // Message deleted
				this.sendSystemMessage(`A message from ${modMsg.userLogin} was deleted by a moderator`);
			}
		});

		// Send twitch emotes to upper layer
		const twitchEmotes = this.twitch.getChat()?.props.emotes;
		if (Array.isArray(twitchEmotes)) {
			this.insertTwitchGlobalEmotesToSet(twitchEmotes);
		}

		/**
		 * OBSERVE THE DOM AND GET ADDED COMPONENTS
		 */
		this.observeDOM().pipe(
			takeUntil(this.killed),
			tap(line => {
					this.page.banSliderManager.considerSlider( line );
			}),
			filter(line => !!line.component),
			// Render 7TV emotes
			tap(line => {
				this.renderPaintOnNametag(line);

				if (!!line.component.props.message?.seventv) {
					line.component.props.message.seventv.currenUserID = line.component.props.currentUserID;
					line.component.props.message.seventv.currentUserLogin = line.component.props.currentUserLogin;
					line.component.props.message.seventv.patcher?.render(line);
				}
			}),
		).subscribe();
	}

	/**
	 * Re-render messages with 7TV
	 */
	private rerenderAll(lines: Twitch.ChatLineAndComponent[]): void {
		for (const line of lines) {
			if (!line.component?.props) continue;
			this.onMessage(line.component.props.message, line);
			this.renderPaintOnNametag(line);
		}
	}

	/**
	 * Patch a chat line with a nametag paint when applicable
	 */
	renderPaintOnNametag(line: Twitch.ChatLineAndComponent): void {
		if (!line.component.props || !line.component.props.message) {
			return undefined;
		}
		const user = line.component.props.message.user;
		const userID = parseInt(user.userID);
		// Add paint?
		if (!!user && this.page.site.paintMap.has(userID)) {
			const paintID = this.page.site.paintMap.get(userID);
			if (typeof paintID === 'number') {
				line.element.querySelector('[data-a-target="chat-message-username"], .chat-author__display-name')?.setAttribute('data-seventv-paint', paintID.toString());
			}
		}
	}

	private onMessage(msg: Twitch.ChatMessage, renderAs: Twitch.ChatLineAndComponent | null = null): void {
		/**
		 * Push new messages as "pending" while we are waiting for Twitch to create the component
		 * We can edit the message in the meantime
		 * @see observeDOM()
		 */
		this.pendingMessages.add(msg.id);

		// Push emotes to seventv.emotes property
		const patcher = new MessagePatcher(this.page, msg);
		msg.seventv = {
			patcher,
			parts: [],
			badges: [],
			words: [],
			is_slash_me: msg.messageType === 1
		};

		// Tokenize 7TV emotes to Message Data
		// This detects/matches 7TV emotes as text and adds it to a seventv namespace within the message
		patcher.tokenize();

		this.linesRendered++;
		if (this.linesRendered === 1) {
			setTimeout(() => this.onMessage(msg), 100);
		}
		if (!!renderAs) {
			patcher.render(renderAs);
		}
	}

	sendSystemMessage(msg: string): void {
		const controller = this.twitch.getChatController();

		if (controller) {
			const id = Date.now().toString();
			const text = msg.replace(/\$currentChannel/g, controller.props.channelLogin);
			controller.pushMessage({
				id,
				msgid: id,
				channel: `#${controller.props.channelLogin}`,
				type: 32,
				message: `[7TV] ${text}`
			});
		}
	}

	/**
	 * Observe the DOM for additions and get message components of pending messages
	 */
	observeDOM(): Observable<Twitch.ChatLineAndComponent> {
		return new Observable<Twitch.ChatLineAndComponent>(observer => {
			Logger.Get().info('Creating MutationObserver');

			const mutationObserver = new MutationObserver(mutations => {
				for (const m of mutations) {
					for (const n of m.addedNodes) {
						const r = this.twitch.getChatLine(n as HTMLElement);

						observer.next({
							element: n as HTMLDivElement,
							component: r.component as Twitch.ChatLineComponent,
							inst: r.instance
						});
					}
				}
			});

			const container = this.twitch.getChat().state.chatListElement.querySelector('.chat-scrollable-area__message-container');
			if (!container) throw new Error('Could not find chat container');

			mutationObserver.observe(container, {
				childList: true
			});
		});
	}

	insertTwitchGlobalEmotesToSet(emoteSets: Twitch.TwitchEmoteSet[]): void {
		// Iterate through sets, and start adding to our twitch set
		const emotes = [] as DataStructure.Emote[];
		for (const twset of emoteSets) {
			for (const emote of twset.emotes) {
				emotes.push({
					id: emote.id,
					name: emote.token,
					visibility: 0,
					provider: 'TWITCH',
					status: Constants.Emotes.Status.LIVE,
					tags: [],
					width: [28, 56, 112, 112],
					height: [28, 56, 112, 112],
					owner: !!twset.owner ? {
						id: twset.owner.id,
						display_name: twset.owner.displayName,
						login: twset.owner.login
					} as DataStructure.TwitchUser : undefined
				});
			}
		}

		// Delete the twitch set if it already existed then recreate it
		if (emoteStore.sets.has('twitch')) {
			emoteStore.sets.delete('twitch');
		}
		emoteStore.enableSet(`twitch`, emotes);
	}

	kill(): void {
		this.killed.next(undefined);
		this.killed.complete();
	}

	get chatInputNode() {
		return this.twitch.getReactInstance(document.querySelector('.chat-input__textarea'));
	}

	logMessages(): void {
		this.twitch.getChatController().props.messageHandlerAPI.addMessageHandler((msg: Twitch.ChatMessage) => {
			if (msg.type == 0) this.messageLog.push(msg);
		});
	}

	overrideGrouper(): void {
		const grouper = (this.twitch.findReactChildren(this.chatInputNode, n => n.stateNode.determineGroup, 300) as any).stateNode;
		const old = grouper.determineGroup;
		grouper.determineGroup = function (command: any) {
			return command.group ? command.group : old.call(this, command);
		};
	}

	addCommand(command: Twitch.ChatCommand): void {
		Logger.Get().debug('Injected command: ' + command.name);
		const cmdNode = (this.twitch.findReactParents(this.chatInputNode, n => n.stateNode.addCommand, 300) as any).stateNode;
		cmdNode.addCommand(command);
	}

	async doNuke(past: number, future: number | undefined, action: Action['types'], pattern: RegExp): Promise<number> {
		const start = Date.now() - (past * 1000);
		const controller = this.twitch.getChatController();

		const msgBuilder = (msg: Twitch.ChatMessage) => {
			switch(action) {
				case 'ban':
					return `.ban ${msg.user} Nuked`;
				case 'delete':
					return `.delete ${msg.id}`;
				default:
					return `.timeout ${msg.user} ${action} Nuked`;
			}
		};

		const myID = this.twitch.getChatController().props.userID;
		let ammount = 0;
		let seen = new Set<string>();

		const check = (msg: Twitch.ChatMessage) => {
			if (msg.type !== 0 || msg.user.userID == myID || msg.user.userType == 'mod') return;
			if (action != 'delete' && seen.has(msg.user.userID)) return;

			if (pattern.test(msg.messageBody)) {
				controller.sendMessage(msgBuilder(msg), undefined);
				seen.add(msg.user.userID);
				ammount += 1;
			}
		};

		for (const msg of this.messageLog.reverse()){
			if (msg.timestamp < start) break;
				check(msg);
		}

		if (future) {
			const handler = (msg: Twitch.ChatMessage) => {
				if (msg.type === 0) check(msg);
			};

			controller.props.messageHandlerAPI.addMessageHandler(handler);

			setTimeout(() => {
				controller.props.messageHandlerAPI.removeMessageHandler(handler);
				this.sendSystemMessage(`Nuke of pattern ${pattern} ended.`);
			}, future * 1000);
		}

		return ammount;

	}

	private commandHandlers: {[name: string]: Twitch.ChatCommand.Callback} = {
		nuke: (args: string) => {
			let before, after, action, regex;
			try {
				const split = args.split(' ');
				if (split.length < 3) throw new Error;
				try {
					[before, after] = split[0].split(':').map(t => {
						return ({s: 1, m: 60, h: 60*60, d: 24*60*60} as any)[t.slice(-1).toLowerCase()] * parseInt(t.slice(0, -1));
					});
					if (isNaN(before)) throw new Error;
				} catch (_) {
					throw new Error('Invalid timebounds. Usage: <past:future> -> 10m:5m or 10m if no percistence into the future. An integer, followed by d for day, h for hour, m for minute, s for second. ' );
				}

				try {
					const test = /[0-9]*[dmhs]?/.test(split[1].toLowerCase());
					if ((split[1].toLowerCase() == 'delete' || split[1].toLowerCase() == 'ban' || test)) {
						action = split[1];
					} else throw new Error;
				} catch (_) {
					throw new Error('Invalid action. Usage: <action> is either ban, delete or timeout in the format 10s or 5m etc');
				}

				try {
					const unparsed = split.slice(2).join(' ');
					regex = IsREGEX.test(unparsed) ? new RegExp(unparsed.split('/')[1], unparsed.split('/')[2]) : new RegExp(unparsed);
				} catch (_) {
					throw new Error('Invalid pattern. Usage <pattern/regex> either text that will be searched for or a regex pattern in the form /pattern/ .');
				}

			} catch (err: any) {
				return {
					deferred: Promise.resolve({
						notice: err.message || this.commands.nuke.helpText,
						error: 'Invalid arguments'
				})};
			}

			return {
				deferred: this.doNuke(before, after, action as Action['types'], regex).then((ammount: number) => {
					return {
						notice: `Nuked ${ammount} users!`
					};
			})};
		}
	};

	private commands: {[name: string]: Twitch.ChatCommand} = {
		nuke: {
			name: 'nuke',
			description: '⚠️ Nuke a phrase in the chat! - /help nuke',
			helpText: 'Usage: "/nuke <timebounds past:future> <action> <phrase>. "/nuke 3m 10m something bad" would give a 10 minute timeout to anything containing the phrase "something bad" going back 3 minutes in the past. "/nuke 5m:5m ban /i ?hate ?(red)|(blue)|(green)/gi" would ban everything that matches the regex going back 5 minutes and keep banning for 5 minutes. Actions are: delete, ban or duration in d, m, h or s. For regex see regex101.com. Using this wrong can cause huge accidents but can also be a very powerfull tool.',
			permissionLevel: 2,
			handler: this.commandHandlers.nuke,
			commandArgs: [
				{
					name: 'timebounds',
					isRequired: true
				},
				{
					name: 'action',
					isRequired: true
				},
				{
					name: 'phrase',
					isRequired: true
				}
			],
			group: '7TV'
		}
	};
}

export interface Action {
	types: 'ban' | 'delete' | number;
}
