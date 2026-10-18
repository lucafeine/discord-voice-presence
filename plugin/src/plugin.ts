import streamDeck from "@elgato/streamdeck";
import { VoicePresenceInfobar } from "./actions/infobar.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new VoicePresenceInfobar());

// La connexion au RPC Discord est ouverte a la premiere action placee et fermee
// quand plus aucune ne l'est : il n'y a donc rien a couper explicitement ici.
await streamDeck.connect();
streamDeck.logger.info("Connecte a Stream Deck.");
