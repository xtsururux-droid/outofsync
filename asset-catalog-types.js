/**

 * asset-catalog-types.js — 与 editor/asset-catalog-types.js 保持同步的拷贝（BU 运行端）

 * 勿在本文件单独改类型清单；请改 editor 主本后覆盖到本文件。

 */

const AssetCatalogTypes = {

    ALL_TYPES: Object.freeze([

        'characters',

        'backgrounds',

        'storyGraphics',

        'items',

        'music',

        'sounds',

        'particles'

    ]),



    all() {

        return this.ALL_TYPES;

    },



    subdir(type) {

        const m = {

            characters: 'characters',

            backgrounds: 'backgrounds',

            storyGraphics: 'story_graphics',

            items: 'items',

            music: 'music',

            sounds: 'sounds',

            particles: 'particles'

        };

        return m[String(type || '')] || '';

    },



    extensions(type) {

        const m = {

            characters: ['webp', 'png', 'jpg', 'jpeg', 'gif'],

            backgrounds: ['webp', 'png', 'jpg', 'jpeg', 'gif'],

            storyGraphics: ['webp', 'png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'ogg', 'mov', 'm4v'],

            items: ['webp', 'png', 'jpg', 'jpeg', 'gif'],

            music: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],

            sounds: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],

            particles: ['png', 'webp', 'jpg', 'jpeg', 'gif']

        };

        return m[String(type || '')] || [];

    },



    emptyLibrary() {

        const lib = {};

        this.all().forEach(t => {

            lib[t] = [];

        });

        return lib;

    },



    emptyEmbedded() {

        return this.normalizeEmbedded(null);

    },



    emptyUsedSets() {

        const out = {};

        this.all().forEach(t => {

            out[t] = new Set();

        });

        return out;

    },



    normalizeEmbedded(embed) {

        const out = {};

        this.all().forEach(type => {

            out[type] = embed && Array.isArray(embed[type]) ? embed[type] : [];

        });

        if (embed && typeof embed === 'object') {

            const known = new Set(this.all());

            const extra = Object.keys(embed).filter(k => !known.has(k));

            if (extra.length && typeof console !== 'undefined' && console.warn) {

                console.warn(

                    '[AssetCatalogTypes] 剧本内嵌资源表含未登记类型，读取时已忽略：',

                    extra

                );

            }

        }

        return out;

    },



    verifyManagerShape(manager, label) {

        if (!manager || typeof manager !== 'object') return [];

        const missing = [];

        this.all().forEach(type => {

            const pe = manager.projectEmbedded;

            if (pe && !Array.isArray(pe[type])) missing.push(`projectEmbedded.${type}`);

            const lib = manager.library;

            if (lib && !Array.isArray(lib[type])) missing.push(`library.${type}`);

        });

        if (missing.length && typeof console !== 'undefined' && console.error) {

            console.error(

                `[AssetCatalogTypes] ${label || 'AssetManager'} 未覆盖全部资源类型：`,

                missing

            );

        }

        return missing;

    }

};



if (typeof window !== 'undefined') window.AssetCatalogTypes = AssetCatalogTypes;

