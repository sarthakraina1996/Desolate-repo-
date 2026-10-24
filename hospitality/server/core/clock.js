// Timestamps for business events. Services use the actor's clock when it has one (the demo
// simulation replays a year of operations with its own clock); otherwise the real time.
export const stamp = (actor) => (actor?.clock ? actor.clock() : new Date().toISOString());
