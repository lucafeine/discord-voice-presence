/**
 * Logging adapter.
 *
 * The Discord layer modules come from the prototype, where they wrote to
 * stderr. Here everything goes through the Stream Deck logger: messages end up
 * in `<uuid>.sdPlugin/logs/`, the only place the user can inspect them.
 */

import streamDeck from "@elgato/streamdeck";

const logger = streamDeck.logger.createScope("discord");

export const log = {
	step(message: string): void {
		logger.info(message);
	},
	info(message: string): void {
		logger.info(message);
	},
	ok(message: string): void {
		logger.info(message);
	},
	warn(message: string): void {
		logger.warn(message);
	},
	error(message: string): void {
		logger.error(message);
	}
};
