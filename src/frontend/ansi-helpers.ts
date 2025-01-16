/* eslint-disable @stylistic/no-multi-spaces */
export const ESC            = '\x1b';         // ASCII escape character
export const CSI            = ESC + '[';      // control sequence introducer
export const BOLD           = CSI + '1m';
export const RESET          = CSI + '0m';
export const BR_MAGENTA_FG  = CSI + '95m';    // Bright magenta foreground
export const BR_GREEN_FG    = CSI + '92m';    // Bright green foreground
/* eslint-enable */

export function greenFormat(msg) {
    return BR_GREEN_FG + msg + RESET;
}

export function magentaFormat(msg) {
    return BR_MAGENTA_FG + msg + RESET;
}
