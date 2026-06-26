/**
 * inventory-system.js - 人物背包逻辑
 */
const InventorySystem = {
    ensureState() {
        if (typeof GameState === 'undefined') return null;
        if (!GameState.characterInventories || typeof GameState.characterInventories !== 'object') {
            GameState.characterInventories = {};
        }
        return GameState.characterInventories;
    },

    addItem(characterId, itemId, opts = {}) {
        const inventories = this.ensureState();
        const cid = String(characterId || 'player').trim() || 'player';
        const iid = String(itemId || '').trim();
        if (!inventories || !iid) return false;
        const project = opts.project || (typeof SceneManager !== 'undefined' ? SceneManager.storyData : null);
        const item = typeof ItemLibraryConfig !== 'undefined' ? ItemLibraryConfig.findItem(project, iid) : null;
        if (!inventories[cid]) inventories[cid] = { characterId: cid, items: {} };
        const bag = inventories[cid].items || (inventories[cid].items = {});
        const count = Math.max(1, Number.isFinite(Number(opts.count)) ? Math.round(Number(opts.count)) : 1);
        if (bag[iid]) {
            if (item && !item.stackable) return true;
            bag[iid].count = Math.max(1, Number(bag[iid].count || 1) + count);
            bag[iid].lastSource = String(opts.source || bag[iid].lastSource || '').trim();
            bag[iid].lastAcquiredAt = new Date().toISOString();
            return true;
        }
        bag[iid] = {
            itemId: iid,
            count,
            source: String(opts.source || '').trim(),
            acquiredAt: new Date().toISOString()
        };
        if (typeof GameState !== 'undefined' && GameState._log) {
            GameState._log('inventory', { characterId: cid, itemId: iid, count, source: opts.source || '' });
        }
        return true;
    },

    hasItem(characterId, itemId) {
        const inventories = this.ensureState();
        const cid = String(characterId || 'player').trim() || 'player';
        const iid = String(itemId || '').trim();
        return !!(inventories && inventories[cid] && inventories[cid].items && inventories[cid].items[iid]);
    },

    getInventory(characterId) {
        const inventories = this.ensureState();
        const cid = String(characterId || 'player').trim() || 'player';
        return inventories && inventories[cid] ? inventories[cid] : { characterId: cid, items: {} };
    }
};

if (typeof window !== 'undefined') window.InventorySystem = InventorySystem;
