import {readFileSync} from 'node:fs';
import {parseSnapshot,summarizeTargets} from '../extension/parser.js';
const snapshot=JSON.parse(readFileSync(process.argv[2],'utf8'));
const parsed=parseSnapshot(snapshot);
console.log(JSON.stringify({conditions:snapshot.conditions,count:parsed.trains.length,
  targets:summarizeTargets(parsed.trains,['07:47','08:20']),
  availability:parsed.trains.map(t=>({number:t.key.number,time:t.key.time,classes:t.availableClasses}))},null,2));
