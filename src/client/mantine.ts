/**
 * Per-component Mantine stylesheets.
 *
 * Importing the full core stylesheet costs 33.6 KB gzipped; importing only the
 * components in use costs less than half that, which is the figure ADR 0006
 * was decided on. Add a line here when a new component is used — a missing
 * import shows up as an unstyled control, not an error, so no behaviour test
 * will catch it.
 *
 * ORDER MATTERS, and getting it wrong also fails silently. Several components
 * share a root element with a lower-level one — a `Button` is also an
 * `UnstyledButton` — and their rules have equal specificity, so whichever
 * sheet comes last wins. Alphabetical order put `UnstyledButton.css` after
 * `Button.css`, and every button on the site lost its background, padding and
 * border while every test still passed.
 *
 * The order below is Mantine's own, taken from the concatenated
 * `@mantine/core/styles.css`. `mantine.test.ts` checks it against that file,
 * so a new import in the wrong place fails the suite rather than the design.
 */
import '@mantine/core/styles/baseline.css';
import '@mantine/core/styles/default-css-variables.css';
import '@mantine/core/styles/global.css';

import '@mantine/core/styles/ScrollArea.css';
import '@mantine/core/styles/UnstyledButton.css';
import '@mantine/core/styles/VisuallyHidden.css';
import '@mantine/core/styles/Paper.css';
import '@mantine/core/styles/Overlay.css';
import '@mantine/core/styles/Popover.css';
import '@mantine/core/styles/Loader.css';
import '@mantine/core/styles/CloseButton.css';
import '@mantine/core/styles/Group.css';
import '@mantine/core/styles/ModalBase.css';
import '@mantine/core/styles/Input.css';
import '@mantine/core/styles/Alert.css';
import '@mantine/core/styles/Text.css';
import '@mantine/core/styles/Anchor.css';
import '@mantine/core/styles/Badge.css';
import '@mantine/core/styles/Button.css';
import '@mantine/core/styles/Card.css';
import '@mantine/core/styles/Container.css';
import '@mantine/core/styles/Menu.css';
import '@mantine/core/styles/Modal.css';
import '@mantine/core/styles/Radio.css';
import '@mantine/core/styles/Stack.css';
import '@mantine/core/styles/Table.css';
