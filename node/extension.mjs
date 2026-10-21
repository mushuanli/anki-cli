import { invoke } from './process.mjs';
import { createHash } from 'node:crypto';
import { packageCards, reconcilePackage } from './package.mjs';

export function createTools({ buildTool, z }) {
    const common = {
        version: '1', maxResultSizeChars: 100000,
        async prompt() { return this.description(); },
        mapToolResultToToolResultBlockParam(data, id) { return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(data) }; },
    };
    return [
        buildTool({ ...common, name: 'anki.prepare', searchHint: 'Validate and normalize Anki words', isReadOnly: () => true,
            inputSchema: z.object({ source: z.union([z.string().min(1), z.array(z.record(z.string(), z.unknown())).min(1)]) }),
            async description() { return 'Parse word lines, Unit markers or WordData JSON before model requests. Validate identities and batch size.'; },
            async call(args, context) { return { data: await invoke(['prepare'], { source: sourceText(args.source) }, context) }; },
        }),
        buildTool({ ...common, name: 'anki.plan', searchHint: 'Plan Anki card media tasks', isReadOnly: () => true,
            inputSchema: z.object({ cards: z.unknown(), source: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(), deck_name: z.string().min(1), directory: z.string().min(1), images: z.boolean(), audio: z.boolean(), voice: z.string().optional() }),
            async description() { return 'Validate word cards and construct deterministic media and packaging nodes. Does not call models or write project files.'; },
            async call(args, context) {
                const generated = typeof args.cards === 'string' ? JSON.parse(args.cards) : args.cards;
                const cards = Array.isArray(generated) ? generated : generated.cards;
                if (!context.operationId) throw new Error('Planning requires a durable operation identity');
                const export_key = createHash('sha256').update(context.operationId).digest('hex').slice(0,16);
                return { data: await invoke(['plan'], { ...args, source: sourceText(args.source), cards, export_key }, context) };
            },
        }),
        buildTool({ ...common, name: 'anki.package', searchHint: 'Package Anki cards with media',
            inputSchema: z.object({ manifest: z.record(z.string(), z.unknown()), directory: z.string().min(1), export_key: z.string().regex(/^[a-f0-9]{16}$/).optional(), media: z.array(z.object({ card: z.number().int().min(0), field: z.enum(['image','audio','audio_example']), result: z.unknown() })) }),
            async description() { return 'Export authorized generated media, write anki.manifest.yaml and atomically build deck.apkg using the Rust anki-cli.'; },
            async call(args, context) { return { data: await packageCards(args, context) }; },
            reconcile: reconcilePackage,
        }),
    ];
}

function sourceText(value) { return value === undefined || typeof value === 'string' ? value : JSON.stringify(value); }
