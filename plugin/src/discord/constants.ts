/**
 * Identite de l'application Discord utilisee par le plugin.
 *
 * `client_id` est public par nature : il est visible dans toute URL
 * d'autorisation. Le flux PKCE n'embarque aucun secret, donc rien d'extractible
 * ici.
 *
 * ⚠️ Pour une publication sur le Marketplace, il faut une application Discord
 * dediee au plugin (celle-ci appartient au developpeur et sert au developpement),
 * avec :
 *   - OAuth2 -> Public Client active
 *   - OAuth2 -> Redirects : une URI enregistree, en premiere position
 */
export const DISCORD_CLIENT_ID = "1561445270804504647";

/**
 * `rpc` couvre GET_SELECTED_VOICE_CHANNEL, VOICE_STATE_* et
 * VOICE_CHANNEL_SELECT. Ce dernier est le seul moyen d'etre notifie
 * instantanement d'un changement de salon.
 */
export const DISCORD_SCOPES = ["rpc"];
