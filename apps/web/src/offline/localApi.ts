/** Offline (artifact) build: the REST API answered locally from the browser store. */
import {
  AVATARS,
  CHARACTERS,
  isCharacterId,
  isSkinUnlocked,
  isValidUsername,
  titlesFor,
  type FriendEntry,
  type MatchHistoryEntry,
  type Profile,
} from '@shadow-hunt/shared';
import { getStore, type ProfilePatch } from './localStore';

const ID_KEY = 'sh.offline.id';

class LocalApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function playerId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = `local-${crypto.randomUUID()}`;
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return 'local-player';
  }
}

const me = () => getStore().ensureProfile({ playerId: playerId(), isGuest: true });
const ONLINE_ONLY = 'Friends and rooms with other players need the online version of the game.';

export const localApi = {
  health: async () => ({ ok: true, store: 'local' }),
  guest: async (_name?: string) => ({ token: 'local', profile: await me() }),
  profile: async () => ({ profile: await me() }),
  updateProfile: async (body: {
    username?: string;
    avatar?: string;
    title?: string;
    skin?: { characterId: string; skinId: string };
  }): Promise<{ profile: Profile }> => {
    const current = await me();
    const patch: ProfilePatch = {};
    if (body.username !== undefined) {
      if (!isValidUsername(body.username)) throw new LocalApiError(400, 'Names are 3–16 letters, numbers or underscores.');
      patch.username = body.username;
    }
    if (body.avatar !== undefined) {
      if (!(AVATARS as readonly string[]).includes(body.avatar)) throw new LocalApiError(400, 'Unknown avatar');
      patch.avatar = body.avatar;
    }
    if (body.title !== undefined) {
      if (!titlesFor(current.level, current.achievements).some((t) => t.id === body.title))
        throw new LocalApiError(400, 'Title not unlocked');
      patch.title = body.title;
    }
    if (body.skin !== undefined) {
      const { characterId, skinId } = body.skin;
      if (
        !isCharacterId(characterId) ||
        !isSkinUnlocked(characterId, skinId, current.level) ||
        current.level < CHARACTERS[characterId].unlockLevel
      )
        throw new LocalApiError(400, 'Skin not unlocked');
      patch.equippedSkins = { ...current.equippedSkins, [characterId]: skinId };
    }
    return { profile: await getStore().updateProfile(current.id, patch) };
  },
  history: async (): Promise<{ history: MatchHistoryEntry[] }> => ({ history: await getStore().history(playerId(), 25) }),
  friends: async (): Promise<{ friends: FriendEntry[] }> => ({ friends: [] }),
  addFriend: async (_username: string): Promise<{ ok: boolean }> => {
    throw new LocalApiError(400, ONLINE_ONLY);
  },
  removeFriend: async (_id: string): Promise<{ ok: boolean }> => ({ ok: true }),
  room: async (_code: string) => ({ exists: false as boolean, joinable: false as boolean }),
};
