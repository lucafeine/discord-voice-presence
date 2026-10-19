/**
 * Discord application identity used by the plugin.
 *
 * `client_id` is public by nature: it is visible in every authorization URL.
 * The PKCE flow embeds no secret, so nothing is extractable here.
 *
 * For a Marketplace release, use a Discord application dedicated to the plugin
 * (this one belongs to the developer and is used for development), with:
 *   - OAuth2 -> Public Client enabled
 *   - OAuth2 -> Redirects: one URI registered, in first position
 */
export const DISCORD_CLIENT_ID = "1561445270804504647";

/**
 * `rpc` covers GET_SELECTED_VOICE_CHANNEL, VOICE_STATE_*, and
 * VOICE_CHANNEL_SELECT. The latter is the only way to be notified instantly of
 * a channel change.
 */
export const DISCORD_SCOPES = ["rpc"];
