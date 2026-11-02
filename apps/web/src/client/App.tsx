import { TopBar } from "./components/TopBar.tsx";
import { DemoLayer } from "./demo/DemoLayer.tsx";
import { AppProvider, useApp } from "./hooks/useApp.tsx";
import { useRoute } from "./hooks/useRoute.ts";
import { useSettings } from "./hooks/useSettings.ts";
import { Exec } from "./screens/Exec.tsx";
import { Home } from "./screens/Home.tsx";
import { OnePager } from "./screens/OnePager.tsx";
import { Questions } from "./screens/Questions.tsx";
import { Staff } from "./screens/Staff.tsx";

function Shell() {
  const [route] = useRoute();
  const settings = useSettings();
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
  return (
    <AppProvider>
      <Shell />
      <DemoLayer />
    </AppProvider>
  );
}
