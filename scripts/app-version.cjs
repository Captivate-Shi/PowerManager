'use strict';

const { version } = require('../package.json');
const match = typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d?)(?:-rc\.(0|[1-9]\d*))?$/.exec(version);
if (!match || match[0] !== version || match.slice(1, 4).some((part) => Number(part) > 65535)) {
  throw new Error('Invalid application version in package.json');
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--windows')) {
  throw new Error('Usage: node scripts/app-version.cjs [--windows]');
}
console.log(args[0] === '--windows' ? match.slice(1, 4).join('.') + '.0' : version);
