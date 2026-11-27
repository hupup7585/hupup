// shared helpers (imported after the mocks in each test file)
export const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
export const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
export const gatherAction = (xml: string) => xml.match(/<Gather [^>]*action="([^"]+)"/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
export const split = (to: string) => { const [a, q = ""] = to.split("?"); return [a, q] as const; };
