/**
 * Adaptateur de journalisation.
 *
 * Les modules de la couche Discord viennent du prototype, ou ils ecrivaient sur
 * stderr. Ici, tout part dans le logger de Stream Deck : les messages se
 * retrouvent dans `<uuid>.sdPlugin/logs/`, ce qui est le seul endroit ou
 * l'utilisateur peut les consulter.
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
