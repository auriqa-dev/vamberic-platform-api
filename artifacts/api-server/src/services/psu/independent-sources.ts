import { publicPageUrl } from "@workspace/agent-runtime-protocol";
/** Conservative discovery filter, not verification of third-party claims. */
export function independentSources(
  urls: string[],
  websites: string[],
  name: string,
): string[] {
  const hosts = websites.map((url) =>
    new URL(url).hostname.toLowerCase().replace(/^www\./, ""),
  );
  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const identity = words(name);
  if (identity.length < 3) return [];
  return [
    ...new Set(
      urls.flatMap((value) => {
        try {
          const url = new URL(publicPageUrl(value));
          if (
            hosts.some(
              (host) =>
                url.hostname === host || url.hostname.endsWith("." + host),
            )
          )
            return [];
          if (/\.(png|jpg|jpeg|gif|svg|webp|pdf)$/i.test(url.pathname))
            return [];
          const address = words(
            decodeURIComponent(url.hostname + url.pathname),
          );
          if (!(" " + address + " ").includes(" " + identity + " ")) return [];
          for (const key of [...url.searchParams.keys()])
            if (key.startsWith("utm_")) url.searchParams.delete(key);
          return [url.toString()];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
