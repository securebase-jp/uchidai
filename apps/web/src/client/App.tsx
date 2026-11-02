import { MotionConfig } from "motion/react";
import { TopBar } from "./components/TopBar.tsx";
import { DemoLayer } from "./demo/DemoLayer.tsx";
import { AiAttackerProvider } from "./hooks/useAiAttacker.tsx";
import { AppProvider, useApp } from "./hooks/useApp.tsx";
import { RequestsProvider } from "./hooks/useRequests.tsx";
import { answerToken, useRoute } from "./hooks/useRoute.ts";
import { type Settings, useSettings } from "./hooks/useSettings.ts";
import { Answer } from "./screens/Answer.tsx";
import { Exec } from "./screens/Exec.tsx";
import { Home } from "./screens/Home.tsx";
import { OnePager } from "./screens/OnePager.tsx";
import { Questions } from "./screens/Questions.tsx";
import { Staff } from "./screens/Staff.tsx";

function Shell({ settings }: { settings: Settings }) {
  const [route] = useRoute();
  const app = useApp();
  return (
    <div className="wrap">
      <TopBar
        route={route}
        {...(app.profile ? { profile: app.profile } : {})}
        {...(app.knowledge ? { attackVersion: app.knowledge.attackVersion } : {})}
        {...(app.caseMeta ? { caseLabel: app.caseMeta.label } : {})}
        theme={settings.theme}
        onToggleTheme={settings.toggleTheme}
      />
      {route === "home" && <Home />}
      {route === "questions" && <Questions reduced={settings.reduced} />}
      {route === "staff" && <Staff settings={settings} />}
      {route === "exec" && <Exec settings={settings} />}
      {route === "onepager" && <OnePager />}
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
