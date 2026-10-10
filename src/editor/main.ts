import { toCfgUri } from '../profile/codec';
import { defaultParams } from '../profile/defaults';

// Placeholder until milestone 2: show the default profile's cfg URI.
document.getElementById('cfg-uri')!.textContent = toCfgUri(defaultParams());
