import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

/** @type {[string, number][]} */
const blockedSubnets = [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]];
const blocked = new BlockList();
for (const [address, prefix] of blockedSubnets)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}

// Pin a verified public address to the socket. Never follow redirects with tokens.
/** @param {URL} url @param {import('./types.js').PublicRequestOptions} options @returns {Promise<Response>} */
export async function publicRequest(url, { headers = {}, signal } = {}) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw new Error("Server address is not public");
  const address = addresses.find((entry) => entry.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(url, {
      method: "GET", headers, signal, agent: false,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [address]) : callback(null, address.address, address.family),
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers))
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      resolve(new Response(/** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(response)), { status: response.statusCode, headers: responseHeaders }));
    });
    request.setTimeout(15000, () => request.destroy(new Error("GitLab timeout")));
    request.on("error", reject);
    request.end();
  });
}
