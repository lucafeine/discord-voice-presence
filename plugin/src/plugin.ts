import streamDeck from "@elgato/streamdeck";
import { VoicePresenceInfobar } from "./actions/infobar.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new VoicePresenceInfobar());

await streamDeck.connect();
streamDeck.logger.info("Connecte a Stream Deck.");
