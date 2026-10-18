import {PASSAGES as passages} from '../shared/passages.ts';
import fs from 'node:fs';
const target = new URL('../shared/passages.json',import.meta.url);
const serialized = JSON.stringify(passages,null,2)+'\n';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target,'utf8') !== serialized) throw new Error('Shared passage library differs from authored shared reference');
} else fs.writeFileSync(target,serialized);
