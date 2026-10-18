/** Generate an Ed25519 node identity key. Put the output in NODE_PRIVATE_KEY (base64 PEM). */
import { generateNodeKeyPair } from '@globalhub/federation';
const kp = generateNodeKeyPair(process.argv[2] ?? 'k1');
console.log(`NODE_KEY_ID=${kp.keyId}`);
console.log(`NODE_PRIVATE_KEY=${Buffer.from(kp.privateKeyPem).toString('base64')}`);
console.error('\nPublic key (shared automatically via /api/v1/federation/node-info):\n' + kp.publicKeyPem);
