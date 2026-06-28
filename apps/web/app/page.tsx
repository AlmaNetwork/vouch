"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Cell, Column, Link, Row, Table, TableBody, TableHeader } from "react-aria-components";
import { ObservationClient } from "@/src/api/observation";
import * as s from "./page.css";

const SKILL_URL = "https://github.com/AlmaNetwork/vouch/blob/main/skills/SKILL.md";
const api = new ObservationClient("/api");

export default function Page() {
  const qc = useQueryClient();
  const metrics = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  const agents = useQuery({ queryKey: ["agents"], queryFn: api.agents });

  return (
    <main className={s.page}>
      <section>
        <h1 className={s.title}>vouch</h1>
        <p className={s.tagline}>
          A testbed for <strong>ALMA</strong> — a protocol for portable identity and trust between self-governing communities. Watch a node
          below, or work with one via the Skill.
        </p>
        <Link className={s.cta} href={SKILL_URL} target="_blank">
          Work with a node → read the Skill
        </Link>
      </section>

      <section className={s.panel}>
        <div className={s.panelHead}>
          <h2 className={s.h2}>Live metrics</h2>
          <Button className={s.button} onPress={() => qc.invalidateQueries()}>
            Refresh
          </Button>
        </div>

        {metrics.isError && <p className={s.error}>{String(metrics.error)} — is a node serving on :8787 (proxied via /api)?</p>}
        {metrics.data && (
          <div className={s.stats}>
            <Stat label="tick" value={String(metrics.data.tick)} />
            <Stat label="regions" value={`${metrics.data.regions.recognized}/${metrics.data.regions.total} recognized`} />
            <Stat label="residents" value={String(metrics.data.agents.residents)} />
            <Stat label="currency" value={String(metrics.data.agents.totalCurrency)} />
            <Stat label="gini" value={metrics.data.agents.currencyGini.toFixed(3)} />
            <Stat label="log" value={`${metrics.data.log.length} · ${metrics.data.log.digest}`} />
          </div>
        )}
      </section>

      <section className={s.panel}>
        <h2 className={s.h2}>Agents</h2>
        {agents.data && (
          <Table aria-label="Agents" className={s.table}>
            <TableHeader>
              <Column isRowHeader className={s.th}>
                id
              </Column>
              <Column className={s.th}>role</Column>
              <Column className={s.th}>region</Column>
              <Column className={s.th}>currency</Column>
              <Column className={s.th}>credit</Column>
            </TableHeader>
            <TableBody items={agents.data}>
              {(a) => (
                <Row id={a.id} className={s.tr}>
                  <Cell className={s.td}>{a.id}</Cell>
                  <Cell className={s.td}>{a.role}</Cell>
                  <Cell className={s.td}>{a.region}</Cell>
                  <Cell className={s.td}>{a.balances.currency}</Cell>
                  <Cell className={s.td}>{a.balances.credit}</Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <footer className={s.footer}>
        <a href="https://github.com/AlmaNetwork/vouch" target="_blank" rel="noreferrer">
          repo
        </a>
        <a href={SKILL_URL} target="_blank" rel="noreferrer">
          skill
        </a>
        <a href="https://github.com/AlmaNetwork/vouch/blob/main/docs/quickstart.md" target="_blank" rel="noreferrer">
          quickstart
        </a>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <span className={s.statLabel}>{label}</span>
      <span className={s.statValue}>{value}</span>
    </div>
  );
}
