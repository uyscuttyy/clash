// Runtime configuration. Values that need to be public are inlined here;
// secrets (private keys, API tokens) stay server-side and are never bundled.
export const WALLETCONNECT_PROJECT_ID=import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '00000000000000000000000000000000'
