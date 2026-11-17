import {registerAction} from './action.js';

registerAction(globalThis.browser || globalThis.chrome);
