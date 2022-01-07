import { CommandManager } from 'src/Sites/twitch.tv/Runtime/CommandManager';
import { Twitch } from 'src/Sites/twitch.tv/Util/Twitch';

export abstract class BaseCommand {
	twitch: Twitch;
	constructor(manager: CommandManager) { this.twitch = manager.twitch; }
	abstract add(): void;
	abstract remove(): void;
	abstract command: Twitch.ChatCommand;
	abstract handler: Twitch.ChatCommand.Handler;
}
