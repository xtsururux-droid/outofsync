const LoveGroupManager = {
    ensureState(gs) {
        const state = gs || (typeof GameState !== 'undefined' ? GameState : null);
        if (!state) return null;
        if (!state.loveGroups || typeof state.loveGroups !== 'object' || Array.isArray(state.loveGroups)) {
            state.loveGroups = {};
        }
        if (!state.loveGroupMembership || typeof state.loveGroupMembership !== 'object' || Array.isArray(state.loveGroupMembership)) {
            state.loveGroupMembership = {};
        }
        return state;
    },

    resolveChar(ref) {
        if (typeof GameState !== 'undefined' && GameState.resolveCharacterRef) {
            return GameState.resolveCharacterRef(ref);
        }
        return String(ref || '').trim();
    },

    _refsToIds(refs) {
        const out = [];
        (Array.isArray(refs) ? refs : [refs]).forEach(ref => {
            const id = this.resolveChar(ref);
            if (id && !out.includes(id)) out.push(id);
        });
        return out;
    },

    _newGroupId(state) {
        let id = '';
        do {
            id = `lovegrp_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
        } while (state.loveGroups[id]);
        return id;
    },

    rebuildMembership(gs) {
        const state = this.ensureState(gs);
        if (!state) return {};
        const map = {};
        Object.keys(state.loveGroups).forEach(gid => {
            const g = state.loveGroups[gid];
            if (!g || g.status !== 'active') return;
            (Array.isArray(g.ukeIds) ? g.ukeIds : []).forEach(id => {
                if (id) map[id] = { groupId: gid, role: 'uke' };
            });
            (Array.isArray(g.semeIds) ? g.semeIds : []).forEach(id => {
                if (id) map[id] = { groupId: gid, role: 'seme' };
            });
        });
        state.loveGroupMembership = map;
        return map;
    },

    getMembership(ref) {
        const state = this.ensureState();
        if (!state) return null;
        const id = this.resolveChar(ref);
        if (!id) return null;
        const cur = state.loveGroupMembership && state.loveGroupMembership[id];
        if (cur && cur.groupId && state.loveGroups[cur.groupId] && state.loveGroups[cur.groupId].status === 'active') return cur;
        const rebuilt = this.rebuildMembership(state);
        return rebuilt[id] || null;
    },

    isInGroup(ref) {
        return !!this.getMembership(ref);
    },

    hasRole(ref, role) {
        const m = this.getMembership(ref);
        if (!m) return false;
        if (!role || role === 'any') return true;
        return m.role === role;
    },

    activeGroupCount(gs) {
        const state = this.ensureState(gs);
        if (!state) return 0;
        return Object.keys(state.loveGroups).filter(gid => {
            const g = state.loveGroups[gid];
            return g && g.status === 'active';
        }).length;
    },

    sameGroup(refA, refB) {
        const a = this.resolveChar(refA);
        const b = this.resolveChar(refB);
        if (!a || !b || a === b) return false;
        const ma = this.getMembership(a);
        const mb = this.getMembership(b);
        return !!(ma && mb && ma.groupId && ma.groupId === mb.groupId);
    },

    areLovers(refA, refB) {
        const a = this.resolveChar(refA);
        const b = this.resolveChar(refB);
        if (!a || !b || a === b) return false;
        const ma = this.getMembership(a);
        const mb = this.getMembership(b);
        if (!ma || !mb || !ma.groupId || ma.groupId !== mb.groupId) return false;
        return (ma.role === 'uke' && mb.role === 'seme') || (ma.role === 'seme' && mb.role === 'uke');
    },

    characterName(id, project) {
        const pid = String(id || '').trim();
        const data = project || (typeof GameState !== 'undefined' && GameState._projectData) || (typeof SceneManager !== 'undefined' ? SceneManager.storyData : null);
        const roster = (data && Array.isArray(data.characterRoster)) ? data.characterRoster : [];
        const hit = roster.find(c => c && String(c.id || '').trim() === pid);
        return (hit && (hit.name || hit.id)) || pid;
    },

    listPairCandidates(project, gs) {
        const state = this.ensureState(gs);
        if (!state) return [];
        const out = [];
        Object.keys(state.loveGroups).forEach(groupId => {
            const g = state.loveGroups[groupId];
            if (!g || g.status !== 'active') return;
            const ukeIds = Array.from(new Set((Array.isArray(g.ukeIds) ? g.ukeIds : []).filter(Boolean)));
            const semeIds = Array.from(new Set((Array.isArray(g.semeIds) ? g.semeIds : []).filter(Boolean)));
            ukeIds.forEach(ukeId => {
                semeIds.forEach(semeId => {
                    if (!ukeId || !semeId || ukeId === semeId) return;
                    const ukeName = this.characterName(ukeId, project);
                    const semeName = this.characterName(semeId, project);
                    out.push({
                        groupId,
                        ukeId,
                        semeId,
                        ukeName,
                        semeName,
                        label: `${ukeName} 和 ${semeName}`
                    });
                });
            });
        });
        return out;
    },

    _removeFromAllGroups(state, id) {
        Object.keys(state.loveGroups).forEach(gid => {
            const g = state.loveGroups[gid];
            if (!g || g.status !== 'active') return;
            g.ukeIds = (Array.isArray(g.ukeIds) ? g.ukeIds : []).filter(x => x !== id);
            g.semeIds = (Array.isArray(g.semeIds) ? g.semeIds : []).filter(x => x !== id);
        });
    },

    _cleanupGroup(state, groupId) {
        const g = state.loveGroups[groupId];
        if (!g || g.status !== 'active') return;
        g.ukeIds = Array.from(new Set((Array.isArray(g.ukeIds) ? g.ukeIds : []).filter(Boolean)));
        g.semeIds = Array.from(new Set((Array.isArray(g.semeIds) ? g.semeIds : []).filter(Boolean)));
        if (!g.ukeIds.length || !g.semeIds.length) {
            g.status = 'disbanded';
            g.disbandedAt = Date.now();
        }
    },

    autoMerge(ukeRefs, semeRefs) {
        const state = this.ensureState();
        if (!state) return { ok: false, reason: 'no-state' };
        this.rebuildMembership(state);
        const ukeIds = this._refsToIds(ukeRefs);
        const semeIds = this._refsToIds(semeRefs);
        if (!ukeIds.length || !semeIds.length) return { ok: false, reason: 'missing-member' };

        const allIds = Array.from(new Set([...ukeIds, ...semeIds]));
        const activeGroupIds = Array.from(
            new Set(
                allIds
                    .map(id => state.loveGroupMembership[id] && state.loveGroupMembership[id].groupId)
                    .filter(gid => gid && state.loveGroups[gid] && state.loveGroups[gid].status === 'active')
            )
        );
        if (activeGroupIds.length > 1) return { ok: false, reason: 'different-groups', groupIds: activeGroupIds };

        const groupId = activeGroupIds[0] || this._newGroupId(state);
        if (!state.loveGroups[groupId]) {
            state.loveGroups[groupId] = { id: groupId, ukeIds: [], semeIds: [], status: 'active', createdAt: Date.now() };
        }
        const g = state.loveGroups[groupId];
        g.status = 'active';
        allIds.forEach(id => this._removeFromAllGroups(state, id));
        ukeIds.forEach(id => {
            if (!g.ukeIds.includes(id)) g.ukeIds.push(id);
        });
        semeIds.forEach(id => {
            if (!g.semeIds.includes(id)) g.semeIds.push(id);
        });
        this._cleanupGroup(state, groupId);
        this.rebuildMembership(state);
        return { ok: true, groupId };
    },

    removeMember(memberRef) {
        const state = this.ensureState();
        if (!state) return { ok: false, reason: 'no-state' };
        this.rebuildMembership(state);
        const id = this.resolveChar(memberRef);
        if (!id) return { ok: false, reason: 'missing-member' };
        const m = state.loveGroupMembership[id];
        if (!m || !m.groupId) return { ok: true, changed: false, reason: 'not-in-group' };
        const g = state.loveGroups[m.groupId];
        if (!g || g.status !== 'active') return { ok: true, changed: false, reason: 'not-in-group' };
        g.ukeIds = (Array.isArray(g.ukeIds) ? g.ukeIds : []).filter(x => x !== id);
        g.semeIds = (Array.isArray(g.semeIds) ? g.semeIds : []).filter(x => x !== id);
        this._cleanupGroup(state, m.groupId);
        this.rebuildMembership(state);
        return { ok: true, changed: true, groupId: m.groupId };
    },

    disbandByMember(memberRef) {
        const state = this.ensureState();
        if (!state) return { ok: false, reason: 'no-state' };
        this.rebuildMembership(state);
        const id = this.resolveChar(memberRef);
        if (!id) return { ok: false, reason: 'missing-member' };
        const m = state.loveGroupMembership[id];
        if (!m || !m.groupId || !state.loveGroups[m.groupId]) return { ok: true, changed: false, reason: 'not-in-group' };
        state.loveGroups[m.groupId].status = 'disbanded';
        state.loveGroups[m.groupId].disbandedAt = Date.now();
        this.rebuildMembership(state);
        return { ok: true, changed: true, groupId: m.groupId };
    },

    applyEffect(effect) {
        const op = String((effect && effect.op) || '').trim();
        if (op === 'merge') return this.autoMerge(effect.ukeRefs || effect.ukeRef, effect.semeRefs || effect.semeRef);
        if (op === 'removeMember') return this.removeMember(effect.memberRef);
        if (op === 'disbandGroup') return this.disbandByMember(effect.memberRef);
        return { ok: false, reason: 'unknown-op' };
    }
};
