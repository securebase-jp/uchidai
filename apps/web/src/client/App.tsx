import { TopBar } from "./components/TopBar.tsx";
import { DemoLayer } from "./demo/DemoLayer.tsx";
import { AiAttackerProvider } from "./hooks/useAiAttacker.tsx";
import { AppProvider, useApp } from "./hooks/useApp.tsx";
import { answerToken, useRoute } from "./hooks/useRoute.ts";
import { useSettings } from "./hooks/useSettings.ts";
import { Answer } from "./screens/Answer.tsx";
import { Exec } from "./screens/Exec.tsx";
import { Home } from "./screens/Home.tsx";
import { OnePager } from "./screens/OnePager.tsx";
import { Questions } from "./screens/Questions.tsx";
import { Staff } from "./screens/Staff.tsx";

function Shell() {
  const [route] = useRoute();
  const settings = useSettings();
  const app = useApp();
  if (route === "answer") {
    const token = answerToken() ?? "";
    return <Answer key={token} token={token} />;
  }
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
  return (
    <AppProvider>
      <AiAttackerProvider>
        <Shell />
        <DemoLayer />
      </AiAttackerProvider>
    </AppProvider>
  );
}
