import { useEffect, useState, type FormEvent } from "react";
import { apiFetch, type ClerkBrowser } from "./clerk";
import { parseCsv } from "./csv";

type HjerterumMember = {
  id: number;
  fullName: string;
  email: string;
  tier: string;
  interval: string;
  status: string;
};

type ExternalMember = {
  id: number;
  externalId: string | null;
  email: string;
  fullName: string;
  membershipLevel: string | null;
  status: string;
  joinedAt: string | null;
  expiresAt: string | null;
  lastSeenAt: number;
};

type ImportBatch = {
  id: number;
  filename: string;
  importedByEmail: string;
  status: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  startedAt: number;
  completedAt: number | null;
};

function Status({ value }: { value: string }) {
  return <span className={"workspace-status " + (value === "active" ? "is-active" : "")}>{value === "active" ? "Aktiv" : value}</span>;
}

export function MembershipAdmin({
  clerk,
  members
}: {
  clerk: ClerkBrowser;
  members: HjerterumMember[];
}) {
  const [externalMembers, setExternalMembers] = useState<ExternalMember[]>([]);
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);

  async function refresh() {
    const [membersResponse, importsResponse] = await Promise.all([
      apiFetch(clerk, "/api/admin/membershipworks-members"),
      apiFetch(clerk, "/api/admin/membership-imports")
    ]);
    if (membersResponse.ok) setExternalMembers(await membersResponse.json() as ExternalMember[]);
    if (importsResponse.ok) setImports(await importsResponse.json() as ImportBatch[]);
  }

  useEffect(() => {
    void refresh();
  }, [clerk]);

  async function importFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setImporting(true);
    setMessage("");
    try {
      const rows = parseCsv(await file.text());
      if (rows.length === 0) throw new Error("csv_empty");
      const response = await apiFetch(clerk, "/api/admin/membership-imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, rows })
      });
      const result = await response.json().catch(() => ({})) as {
        error?: string;
        total?: number;
        created?: number;
        updated?: number;
        unchanged?: number;
        rejected?: number;
      };
      if (!response.ok) throw new Error(result.error || "membership_import_failed");
      setMessage(
        (result.total ?? 0) + " rækker behandlet · " +
        (result.created ?? 0) + " nye · " +
        (result.updated ?? 0) + " opdateret · " +
        (result.unchanged ?? 0) + " uændret · " +
        (result.rejected ?? 0) + " afvist"
      );
      await refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "membership_import_failed";
      setMessage(code === "csv_empty" ? "CSV-filen indeholder ingen medlemmer." : "Importen kunne ikke gennemføres. Kontrollér CSV-filen og prøv igen.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="workspace-section">
      <p className="kicker">Administration</p>
      <h1>Medlemmer</h1>

      <div className="membership-source-summary">
        <article>
          <strong>{members.length}</strong>
          <span>Nye Hjerterum-medlemmer</span>
          <small>Administreres i det nye system</small>
        </article>
        <article>
          <strong>{externalMembers.length}</strong>
          <span>MembershipWorks-medlemmer</span>
          <small>Spejles uden at blive ændret</small>
        </article>
      </div>

      <div className="workspace-two-column membership-admin-grid">
        <form className="workspace-card workspace-form" onSubmit={importFile}>
          <p className="kicker">MembershipWorks</p>
          <h2>Opdatér medlemslisten</h2>
          <p>Eksportér medlemmer som CSV fra MembershipWorks. Gentagne importer matcher på e-mail, opdaterer ændringer og opretter ikke dubletter.</p>
          <label>CSV-fil<input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required /></label>
          <button className="pill-button dark" disabled={importing}>{importing ? "Importerer …" : "Importér medlemsliste"}</button>
          {message && <p className="workspace-message" role="status">{message}</p>}
        </form>

        <div className="workspace-card">
          <p className="kicker">Historik</p>
          <h2>Seneste importer</h2>
          <div className="workspace-list">
            {imports.length ? imports.slice(0, 6).map((batch) => (
              <article key={batch.id}>
                <strong>{batch.filename}</strong>
                <span>{new Date(batch.startedAt).toLocaleString("da-DK")} · {batch.total} rækker</span>
                <span>{batch.created} nye · {batch.updated} ændret · {batch.rejected} afvist</span>
              </article>
            )) : <p>Der er endnu ikke importeret en medlemsliste.</p>}
          </div>
        </div>
      </div>

      <h2 className="membership-list-title">Nye Hjerterum-medlemmer</h2>
      <div className="workspace-table-wrap">
        <table className="workspace-table">
          <thead><tr><th>Navn</th><th>Medlemskab</th><th>Status</th><th>Kontakt</th></tr></thead>
          <tbody>{members.map((member) => (
            <tr key={member.id}>
              <td>{member.fullName}</td>
              <td>{member.tier} · {member.interval === "year" ? "årligt" : "månedligt"}</td>
              <td><Status value={member.status} /></td>
              <td>{member.email}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h2 className="membership-list-title">MembershipWorks-spejl</h2>
      <div className="workspace-table-wrap">
        <table className="workspace-table">
          <thead><tr><th>Navn</th><th>Medlemskab</th><th>Status</th><th>Kontakt</th><th>Senest set</th></tr></thead>
          <tbody>{externalMembers.map((member) => (
            <tr key={member.id}>
              <td>{member.fullName}</td>
              <td>{member.membershipLevel || "—"}</td>
              <td><Status value={member.status} /></td>
              <td>{member.email}</td>
              <td>{new Date(member.lastSeenAt).toLocaleDateString("da-DK")}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
