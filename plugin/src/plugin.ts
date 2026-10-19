import streamDeck from "@elgato/streamdeck";
import { ConnectAction } from "./actions/connect.js";
import { VoicePresenceInfobar } from "./actions/infobar.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new VoicePresenceInfobar());
streamDeck.actions.registerAction(new ConnectAction());

// The Discord RPC connection opens with the first placed action and closes when
// none remain: there is nothing to shut down explicitly here.
await streamDeck.connect();
streamDeck.logger.info("Connected to Stream Deck.");
