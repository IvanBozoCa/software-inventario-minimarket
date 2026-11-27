/** Ajustes del administrador: lo que se configura pocas veces. */
export default function SettingsPage() {
  const items = [
    { href: "#/codigos", title: "Códigos de barra", text: "Escanea los envases para asignar su código a cada producto." },
    { href: "#/categorias", title: "Categorías y márgenes", text: "Margen por categoría para el precio sugerido." },
    { href: "#/usuarios", title: "Usuarios", text: "Quién puede entrar a SIM y qué puede hacer." },
  ];
  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Ajustes</h2>
          <p className="page-intro">Lo que se configura de vez en cuando.</p>
        </div>
      </div>
      <ul className="settings-list">
        {items.map((item) => (
          <li key={item.href}>
            <a className="card settings-link" href={item.href}>
              <strong>{item.title}</strong>
              <span className="muted">{item.text}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
