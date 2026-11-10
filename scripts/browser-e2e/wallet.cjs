// Injected test wallet: EIP-1193 + EIP-6963, backed by the local Hardhat node's unlocked dev accounts.
// Usage: page.addInitScript({ content: walletScript(address) })
// Ports come from the environment so parallel stacks can run side by side (defaults: the usual dev ports).
const WEB = (module.exports.WEB = (process.env.E2E_WEB_URL || 'http://localhost:8080').replace(/\/$/, ''));
const RPC = (module.exports.RPC = process.env.E2E_RPC_URL || 'http://127.0.0.1:8545');
module.exports.walletScript = (address, rpc = RPC) => `(() => {
  const ADDRESS = ${JSON.stringify(address)};
  const RPC = ${JSON.stringify(rpc)};
  const listeners = {};
  let connected = localStorage.getItem('rf-test-wallet') === '1';
  const grant = (on) => { connected = on; localStorage.setItem('rf-test-wallet', on ? '1' : '0'); };
  let id = 0;
  const rpc = async (method, params) => {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  const provider = {
    isTestWallet: true,
    async request({ method, params }) {
      window.__walletLog = window.__walletLog || []; window.__walletLog.push(method);
      switch (method) {
        case 'eth_requestAccounts': grant(true); setTimeout(() => emit('connect', { chainId: '0x7a69' })); return [ADDRESS];
        case 'eth_accounts': return connected ? [ADDRESS] : [];
        case 'eth_chainId': return '0x7a69';
        case 'net_version': return '31337';
        case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
        case 'wallet_requestPermissions': grant(true); return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_getPermissions': return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        case 'wallet_revokePermissions': grant(false); return null;
        case 'personal_sign': return rpc('personal_sign', params);
        default: return rpc(method, params);
      }
    },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); return provider; },
    removeListener(e, f) { listeners[e] = (listeners[e] || []).filter((x) => x !== f); return provider; },
  };
  function emit(e, v) { (listeners[e] || []).forEach((f) => f(v)); }
  window.ethereum = provider;
  const info = { uuid: 'b6d0c9a8-7e4a-4d55-9a3f-realmforge01', name: 'RealmForge Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'dev.realmforge.testwallet' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce);
  announce();
})();`;
