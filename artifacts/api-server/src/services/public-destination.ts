/** Shared destination validation; independent of generation schemas. */
export function safeDestination(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.hash &&
      !/^(localhost|.*\.localhost|.*\.local|.*\.internal|\[.*\]|[\d.]+)$/i.test(
        u.hostname,
      ) &&
      u.hostname.includes(".")
    );
  } catch {
    return false;
  }
}
