import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { CaseChip, CompanyChip } from "./components/CompanyPicker.tsx";
import { Footer } from "./components/Footer.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { DemoLayer } from "./demo/DemoLayer.tsx";
import { AiAttackerProvider } from "./hooks/useAiAttacker.tsx";
import { AppProvider, useApp } from "./hooks/useApp.tsx";
import { RequestsProvider } from "./hooks/useRequests.tsx";
import { answerToken, useRoute } from "./hooks/useRoute.ts";
import { type Settings, useSettings } from "./hooks/useSettings.ts";
import { parseOnePagerHash } from "./onepager/params.ts";
import { Answer } from "./screens/Answer.tsx";
import { Domain } from "./screens/Domain.tsx";
import { Exec } from "./screens/Exec.tsx";
import { Home } from "./screens/Home.tsx";
import { OnePager, SharedOnePager } from "./screens/OnePager.tsx";
import { Profile } from "./screens/Profile.tsx";
import { Questions } from "./screens/Questions.tsx";
import { Sources } from "./screens/Sources.tsx";
import { Staff } from "./screens/Staff.tsx";

function Shell({ settings }: { settings: Settings }) {
  const [route] = useRoute();
  const app = useApp();
  // 画面を切り替えたら先頭から見せる（前の画面のスクロール位置を引き継がない）
  // biome-ignore lint/correctness/useExhaustiveDependencies: route が変わったときだけ先頭へ
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);
  return (
    <div className="wrap">
      <TopBar
        route={route}
        {...(app.knowledge ? { attackVersion: app.knowledge.attackVersion } : {})}
        theme={settings.theme}
        onToggleTheme={settings.toggleTheme}
        chips={
          <>
            <CompanyChip />
            <CaseChip />
          </>
        }
      />
      {route === "home" && <Home />}
      {route === "domain" && <Domain />}
      {route === "questions" && <Questions reduced={settings.reduced} />}
      {route === "profile" && <Profile />}
      {route === "staff" && <Staff settings={settings} />}
      {route === "exec" && <Exec settings={settings} />}
      {route === "onepager" && <OnePager />}
      <Footer />
    </div>
  );
}

export function App() {
  const [route] = useRoute();
  const settings = useSettings();
  // 回答ページ（ベンダーがスマホで開く）は、カルテ・知識・判定を一切読まない軽い画面
  if (route === "answer") {
    const token = answerToken() ?? "";
    return <Answer key={token} token={token} />;
  }
  // 出典の画面も、カルテ・知識・判定を読まない軽い画面（出典の一覧だけを取る）
  if (route === "sources") return <Sources settings={settings} />;
  // 共有リンク（内容を URL に載せた一枚）も同じく軽い画面：カルテ・知識・判定の API を呼ばない。
  // 公開 URL（Cloudflare Tunnel）から社長のスマホで開いても、API の 403 がエラーとして出ない
  const shared = route === "onepager" ? parseOnePagerHash().d : undefined;
  if (shared) {
    return (
      <MotionConfig reducedMotion={settings.reduced ? "always" : "user"}>
        <div className="wrap">
          <TopBar route="onepager" theme={settings.theme} onToggleTheme={settings.toggleTheme} />
          <SharedOnePager key={shared} d={shared} />
        </div>
      </MotionConfig>
    );
  }
  return (
    // 「動きを減らす」は motion のアニメーションにも効かせる（CSS の animation/transition と同じ扱い）
    <MotionConfig reducedMotion={settings.reduced ? "always" : "user"}>
      <AppProvider>
        <AiAttackerProvider>
          <RequestsProvider>
            <Shell settings={settings} />
            <DemoLayer />
          </RequestsProvider>
        </AiAttackerProvider>
      </AppProvider>
    </MotionConfig>
  );
}
