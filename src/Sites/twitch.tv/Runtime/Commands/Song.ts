import { Logger } from 'src/Logger';
import { CommandManager } from 'src/Sites/twitch.tv/Runtime/CommandManager';
import { BaseCommand } from 'src/Sites/twitch.tv/Runtime/Commands/BaseCommand';
import { Twitch } from 'src/Sites/twitch.tv/Util/Twitch';

/**
 *  ToDo list:
 *      Update help text.
 *      Display the result in a better way.
 */

export class Song extends BaseCommand {

	APITOKEN = 'notimplemented';

	constructor(private manager: CommandManager){
		super(manager);
		if (this.APITOKEN === 'notimplemented') return;
		this.add();
	}

	add(){
		this.manager.addCommand(this.command);
	}

	remove(){
		this.manager.removeCommand(this.command);
	}

	async doRequest(blobs: Blob[]): Promise<ApiResponse>{

		const blob = new Blob(blobs, {type: blobs[0].type});
		const file = new File([blob], 'test.webm');

		let fd = new FormData();

		fd.append('api_token', this.APITOKEN);
		fd.append('file', file);
		fd.append('return', 'apple_music,spotify');

		const res = await fetch(URL, {
			method: 'POST',
			body: fd
		});

		const json = await res.json() as ApiResponse;
		return json;

	}

	async startRecording() {

		const videoElement = document.querySelector('.video-player__container video') as HTMLCanvasElement;
		const stream = videoElement.captureStream();
		let mediaRecorder = new MediaRecorder(stream);
		let blobs = new Array<Blob>();

		mediaRecorder.ondataavailable = function(e) {
			blobs.push(e.data);
		};

		mediaRecorder.start(1000);

		await new Promise(resolve=>setTimeout(resolve, 5000));
		mediaRecorder.stop();

		if (blobs.length < 1) {
			return {
				notice: 'Error with blobs'
			};
		}

		const res = await this.doRequest(blobs);

		if (!res.result) {
			return {
				notice: 'Could not recognize song'
			};
		}

		return {
			notice: `Song is:  ${res.result.artist} - ${res.result.title}`
		};
	}

	handler: Twitch.ChatCommand.Handler = () => {
		if (navigator.mediaDevices) {
			return {
				deferred: this.startRecording()
			};
		}
	}

	command: Twitch.ChatCommand = {
		name: 'song',
		description: 'Try to recognize the song',
		helpText: 'The extension will try to get the song using a music recognition api. It does this by listening to the stream for a few seconds and then sending that off to AudD. ',
		permissionLevel: 0,
		handler: this.handler,
		group: '7TV'
	};
}

const URL = 'https://api.audd.io/';

interface ApiResponse {
	status: string;
	result?: {
		artist: string;
		title: string;
		album: string;
		release_date: string;
		label: string;
		timecode: string;
		song_link: string;
	};
}
