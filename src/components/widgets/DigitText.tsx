interface DigitTextProps {
  /** Text with numbers in it, e.g. "09:28:07", "2:34 / 4:12", "23%". */
  text: string;
}

const DIGIT = /\d/;

/**
 * Renders text so that changing numbers do not make it wobble, for use with
 * the Formula1 display face.
 *
 * - That face is proportional - its "0" is a third wider than its "1" - so a
 *   running clock or timer would shift sideways with every change. Each digit
 *   therefore sits in a cell as wide as the widest digit.
 * - Its colon is drawn as a single dot, which turns 09:28 into "09.28". The
 *   colon is taken from the monospace face instead.
 * - All other characters keep their natural shape and width.
 *
 * The cells are hidden from assistive technology; put the readable value in
 * an `aria-label` on the parent.
 */
export function DigitText({ text }: DigitTextProps) {
  return (
    <>
      {text.split("").map((character, index) => {
        if (DIGIT.test(character)) {
          return (
            <span key={index} aria-hidden="true" className="inline-block w-[0.86em] text-center">
              {character}
            </span>
          );
        }
        if (character === ":") {
          return (
            <span
              key={index}
              aria-hidden="true"
              className="inline-block w-[0.4em] text-center font-mono font-bold"
            >
              :
            </span>
          );
        }
        return (
          <span key={index} aria-hidden="true" className="whitespace-pre">
            {character}
          </span>
        );
      })}
    </>
  );
}
