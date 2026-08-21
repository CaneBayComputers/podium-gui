// Product naming, in one place.
//
// Renamed from Podium to Zeltro. Before this, the binary name appeared as a
// bare 'podium' literal in main, renderer and installer — twenty-odd sites, any
// one of which could be missed in a rename and would then fail at runtime on
// someone else's machine rather than at build time here.
//
// main imports this. renderer and installer CANNOT: they are loaded by <script>
// tag and are not modules, so every non-module .ts file shares one global scope
// — two files requiring the same names collide at compile time, and adding an
// `export` to make them modules would stop their top-level functions being
// global, which the HTML's onclick handlers depend on.
//
// So those two keep a literal, and a test asserts all three agree. The check is
// at test time rather than compile time, which is weaker, but it fails loudly
// and does not risk the handler wiring.

/** The CLI's executable name. */
export const CLI_BIN = 'zeltro';

/** Product name as shown to a person. */
export const PRODUCT = 'Zeltro';

/** Machine-wide config directory the CLI writes and the GUI reads. */
export const CLI_CONFIG_DIR = '/etc/zeltro-cli';

/** Prefix on the shared service containers. */
export const SERVICE_PREFIX = 'zeltro';
