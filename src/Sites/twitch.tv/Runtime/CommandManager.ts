import { Logger } from 'src/Logger';
import { TwitchPageScript } from 'src/Sites/twitch.tv/twitch';
import { Twitch } from 'src/Sites/twitch.tv/Util/Twitch';
import { BaseCommand } from 'src/Sites/twitch.tv/Runtime/Commands/BaseCommand';
import * as Modules from 'src/Sites/twitch.tv/Runtime/Commands/';

export class CommandManager {

	twitch = this.main.twitch;
	private cmdNode: Twitch.CommandNode | null = null;

	commands = new Set<BaseCommand>();

	constructor (private main: TwitchPageScript) {}

	private get chatInputNode() {
		return this.twitch.getReactInstance(document.querySelector('.chat-input__textarea'));
	}

	initialize() {
		this.cmdNode = (this.twitch.findReactParents(this.chatInputNode, n => n.stateNode.addCommand, 300) as any).stateNode;
		this.overrideGrouper();

		Object.values(Modules).forEach( module => {
				this.commands.add(new module(this));

		});
	}

	private overrideGrouper(): void {
		const grouper = (this.twitch.findReactChildren(this.chatInputNode, n => n.stateNode.determineGroup, 300) as any).stateNode;
		const old = grouper.determineGroup;
		grouper.determineGroup = function (command: any) {
			return command.group ? command.group : old.call(this, command);
		};
	}

	addCommand(command: Twitch.ChatCommand): void {
		Logger.Get().debug('Added command: ' + command.name);
		this.cmdNode?.addCommand(command);
	}

	removeCommand(command: Twitch.ChatCommand): void {
		Logger.Get().debug('Removed command: ' + command.name);
		this.cmdNode?.removeCommand(command);
	}
}
