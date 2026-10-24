// Connecting a vault in one click. The plugin makes a key pair and opens Tradoshi with
// a pairing id and the PUBLIC key. Once the trader approves the vault in Tradoshi, the
// access token is encrypted with that key and left for the plugin, which reads it once
// and decrypts it with the private key, kept in memory only. Neither Tradoshi's
// database nor the browser address ever holds the token in clear.

export interface Pairing {
	id: string;
	/** Public key, SPKI, base64url: goes in the address opened in the browser. */
	publicKey: string;
	privateKey: CryptoKey;
}

const ALGORITHM = { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

export function toBase64Url(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64(s: string): Uint8Array {
	const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export async function newPairing(): Promise<Pairing> {
	const keys = await crypto.subtle.generateKey(ALGORITHM, false, ["encrypt", "decrypt"]);
	const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
	return { id: toBase64Url(crypto.getRandomValues(new Uint8Array(24))), publicKey: toBase64Url(spki), privateKey: keys.privateKey };
}

/** The token left by Tradoshi, decrypted with the private key of the pairing. */
export async function openSealed(privateKey: CryptoKey, sealed: string): Promise<string> {
	const clear = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, fromBase64(sealed));
	return new TextDecoder().decode(clear);
}
