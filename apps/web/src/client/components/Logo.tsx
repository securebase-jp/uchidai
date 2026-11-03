/** ロゴ：黒背景用と白背景用の 2 枚を置き、表示は CSS の data-theme で切り替える（切り替え時にちらつかない） */
import logoDark from "../assets/logo-dark.webp";
import logoLight from "../assets/logo-light.webp";

export function Logo() {
  return (
    <>
      <img className="logo logo-on-dark" src={logoDark} alt="ウチダイ" width={120} height={40} />
      <img
        className="logo logo-on-light"
        src={logoLight}
        alt=""
        aria-hidden="true"
        width={120}
        height={40}
      />
    </>
  );
}
