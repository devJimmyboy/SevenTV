
import { TwitchPageScript } from 'src/Sites/twitch.tv/twitch';
import { Twitch } from 'src/Sites/twitch.tv/Util/Twitch';

export abstract class BaseCommand {
	manager = this.main.commandManager;
	twitch = this.manager.twitch;
	constructor(public main: TwitchPageScript) {}
	add(this: BaseCommand, cmd: Twitch.ChatCommand) {
		this.manager.addCommand(cmd);
	}
	remove(this: BaseCommand, cmd: Twitch.ChatCommand) {
		this.manager.removeCommand(cmd);
	}
}
