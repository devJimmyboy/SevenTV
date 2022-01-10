import { Logger } from 'src/Logger';
import { BaseCommand } from 'src/Sites/twitch.tv/Runtime/Commands/BaseCommand';
import { TwitchPageScript } from 'src/Sites/twitch.tv/twitch';
import { Twitch } from 'src/Sites/twitch.tv/Util/Twitch';

/**
 *  ToDo list:
 * 		Need to implement a way to get the jwt token before this can be used.
 *      Implement the ablility to enable emotes.
 */

export class Dashboard extends BaseCommand {

	private jwt = this.main.site.config.get('jwt')?.asString();

	private currentChannelID: string | undefined;

	constructor(main: TwitchPageScript){
		super(main);
		if (!this.jwt) return;
		this.setCurrentChannelId()
			.then(() => {
				return this.hasPermission();
			})
			.then(permission=>{
				if (permission) {
					super.add(this.commandEnable);
					super.add(this.commandDisable);
					super.add(this.commandAlias);
				}
			})
			.catch(()=>{
				Logger.Get().warn('Error with determining if you have permission, channel might not have 7tv enabled');
			});
	}

	async hasPermission() {
		const info = this.twitch.getChatController().props;

		if (info.channelID == info.userID) return true;

		const res = await this.sendRequest(querys.editors, {id: this.currentChannelID});
		if (!res.ok) throw new Error;

		const json = await res.json();
		const editor_ids: string[] = json?.data?.user?.editor_ids;

		const res2 = await fetch('https://api.7tv.app/v2/users/' + info.userID);
		if (!res2.ok) throw new Error;

		const json2 = await res2.json();
		const myID = json2.id;

		if (editor_ids.includes(myID)) return true;

		return false;
	}

	async setCurrentChannelId() {
		await fetch('https://api.7tv.app/v2/users/' + this.main.currentChannel)
			.then(response => {
				if (!response.ok) throw new Error;
				return response.json();
			})
			.then(json => {
				if (!json.id) throw new Error;
				this.currentChannelID = json.id;
			})
			.catch(() => {
				throw new Error;
			});

		return;
	}

	async handleRequest(query: string, variables: variables) {
		const res = await this.sendRequest(query, variables);

		if (!res.ok) {
			const json = await res.json();
			if (json.errors.message) {
				return {
					notice: 'Unable to do request: Error message: ' + json.errors.message,
					error: 'Api error'
				};
			}
			return {
				notice: 'Unable to do request. Error code: ' + res.status,
				error: 'Api error'
			};
		}

		return {
			notice: ''
		};
	}

	async sendRequest(query: string, variables: variables) {
		return fetch('https://api.7tv.app/v2/gql',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': this.jwt!
				},
				body: JSON.stringify({
					query: query,
					variables: variables
				})
			}
		);
	}

	async handleEnable(args: string) {
		return {
			notice: 'This command has not been implemented yet. ' + args,
			error: 'Not implemented'
		};
	}

	async handleDisable(args: string) {
		const [emoteName, ...reason] = args.split(' ').filter(n=>n);

		const emote = this.main.emoteStore.getEmote(emoteName);

		if (emote?.provider != '7TV' ) {
			return {
				notice: 'Could not find selected 7TV emote',
				error: 'Missing emote'
			};
		}

		const variables = {
			ch: this.currentChannelID!,
			em: emote.id,
			re: reason.join(' ') ?? 'Edited from twitch chat'
		};

		return this.handleRequest(querys.disable, variables);
	}

	async handleAlias(args: string) {
		const [currentName, newName, ...reason] = args.split(' ').filter(n=>n);

		const emote = this.main.emoteStore.getEmote(currentName);

		if (emote?.provider != '7TV' ) {
			return {
				notice: 'Could not find selected 7TV emote.',
				error: 'Missing emote'
			};
		}

		if (!emoteNameRegex.test(newName)) {
			if (newName !== '-') {
				return {
					notice: 'Illegal characters in new alias',
					error: 'Argument error'
				};
			}
		}

		const variables = {
			ch: this.currentChannelID!,
			em: emote.id,
			data: {
				alias: (newName === '-') ? '' : newName
			},
			re: reason.join(' ') ?? 'Edited from twitch chat'
		};

		return this.handleRequest(querys.alias, variables);
	}

	commandEnable: Twitch.ChatCommand = {
		name: 'enable',
		description: 'Enable a 7tv emote',
		helpText: '',
		permissionLevel: 0,
		handler: (args) => { return { deferred: this.handleEnable(args) }; },
		commandArgs: [
			{
				name: 'Emote',
				isRequired: true
			},
			{
				name: 'Reason',
				isRequired: false
			}
		],
		group: '7TV'
	};

	commandDisable: Twitch.ChatCommand = {
		name: 'disable',
		description: 'Disable a 7TV emote',
		helpText: '',
		permissionLevel: 0,
		handler: (args) => { return { deferred: this.handleDisable(args) }; },
		commandArgs: [
			{
				name: 'Emote',
				isRequired: true
			},
			{
				name: 'Reason',
				isRequired: false
			}
		],
		group: '7TV'
	};

	commandAlias: Twitch.ChatCommand = {
		name: 'alias',
		description: 'Set an alias for a 7TV emote',
		helpText: '',
		permissionLevel: 0,
		handler: (args) => { return { deferred: this.handleAlias(args) }; },
		commandArgs: [
			{
				name: 'Current',
				isRequired: true
			},
			{
				name: 'New',
				isRequired: true
			},
			{
				name: 'Reason',
				isRequired: false
			}
		],
		group: '7TV'
	};
}

const emoteNameRegex = new RegExp(`^[-_A-Za-z():0-9]{2,100}$`);



const querys = {
	enable: '',
	disable: `
		mutation RemoveChannelEmote($ch: String!, $em: String!, $re: String!) {
			removeChannelEmote(channel_id: $ch, emote_id: $em, reason: $re) {
				emote_ids
			}
		}
	`,
	alias: `
		mutation EditChannelEmote($ch: String!, $em: String!, $data: ChannelEmoteInput!, $re: String) {
			editChannelEmote(channel_id: $ch, emote_id: $em, data: $data, reason: $re) {
				id
			}
		}
	`,
	editors: `
		query GetUser($id: String!) {
			user(id: $id) {
				editor_ids
			}
		}
	`
};

interface variables {
	id?: string;
	ch?: string;
	em?: string;
	data?: {
		alias?: string;
	};
	re?: string;
}
