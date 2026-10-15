/** Asked: "Beskrivelsesteksterne under begge to fylder alt for meget og er alt for rodede. De bør stå under et informations-I eller på anden vis kun vises on
 * demand." An explanation folded behind a small "i", opened when asked for. */
export const infoTip = (...lines: string[]) => `<details class="info"><summary aria-label="Mere om det" title="Mere om det">i</summary><div class="small muted">${lines.map(l => `<p>${l}</p>`).join("")}</div></details>`;
