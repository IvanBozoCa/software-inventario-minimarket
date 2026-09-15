import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [backendStatus, setBackendStatus] = useState("comprobando...");

  useEffect(() => {
    fetch("http://127.0.0.1:8010/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("Backend no disponible");
        }

        return response.json();
      })
      .then((data) => {
        setBackendStatus(data.status);
      })
      .catch(() => {
        setBackendStatus("sin conexión");
      });
  }, []);

  return (
    <main className="app">
      <h1>Software Inventario Minimarket</h1>
      <p>Sistema local iniciado correctamente.</p>
      <p>Backend: {backendStatus}</p>
    </main>
  );
}

export default App;
