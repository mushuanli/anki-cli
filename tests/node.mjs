import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { packageCards, reconcilePackage } from '../node/package.mjs';

process.env.ANKI_CLI_BIN ??= fileURLToPath(new URL('../target/debug/anki-cli', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
    const files = new Map(); const bytes = Buffer.from('ID3-fixture');
    const ref = { sessionId:'s',taskId:'media',owner:'tasks/media/task.seq',name:`${hash(bytes)}.bin`,sha256:hash(bytes),mimeType:'audio/mpeg',bytes:bytes.length };
    const context = { operationId:'stable-operation',timeoutMs:10000,signal:new AbortController().signal,
        readAsset:async () => bytes,
        vfs:{ readFile:async path => {if(!files.has(path))throw new Error('missing');return files.get(path).toString();},
            writeFile:async (path,text) => files.set(path,Buffer.from(text)),
            readBinaryFile:async path => {if(!files.has(path))throw new Error('missing');return files.get(path);},
            writeBinaryFile:async (path,data) => files.set(path,Buffer.from(data)) },
    };
    const args = { directory:'output',manifest:{version:1,deck:{id:12345,name:'英语单词'},output:'deck.apkg',cards:[{id:'apple.json',kind:'word',data:{name:'apple',chn:'苹果'}}],media:[]},
        media:[{card:0,field:'audio',result:{assets:[ref]}}] };
    return {files,context,args};
}
test('publishes YAML, actual media and apkg, then reconciles verified receipts without executing again', async () => {
    const {files,context,args} = fixture();
    const result = await packageCards(args,context);
    assert.ok(files.get(result.manifestPath).toString().includes('version: 1'));
    assert.equal(files.get(result.packagePath).subarray(0,2).toString(),'PK');
    assert.deepEqual(await reconcilePackage(args,context),{status:'completed',data:result});
    const media = [...files.keys()].find(path => path.endsWith('.mp3'));files.set(media,Buffer.from('corrupt'));
    assert.equal((await reconcilePackage(args,context)).status,'indeterminate');
    assert.equal((await reconcilePackage(args,{...context,operationId:'another-operation'})).status,'indeterminate');
});
test('rejects invalid output paths and media hashes before publishing a package', async () => {
    const {files,context,args} = fixture();args.directory='../outside';
    await assert.rejects(packageCards(args,context));assert.equal(files.size,0);
    args.directory='output';context.readAsset=async () => Buffer.from('tampered');
    await assert.rejects(packageCards(args,context),/checksum/);assert.equal(files.size,0);
});
