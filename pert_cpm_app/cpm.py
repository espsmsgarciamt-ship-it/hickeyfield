import pandas as pd
import streamlit as st

st.set_page_config(page_title="CPM Calculator", layout="wide")

st.title("📈 Critical Path Method (CPM) Calculator")

st.markdown("""
Enter activities with an Activity ID, a duration (days) and comma-separated predecessors.

| Activity | Duration | Predecessors |
|---|---|---|
| A | 3 | |
| B | 5 | A |
| C | 4 | A |
| D | 2 | B,C |
""")

COLUMNS = ["Activity", "Duration", "Predecessors"]


def parse_preds(text) -> list[str]:
    if not isinstance(text, str) or text.strip() == "-":
        return []
    return [p.strip() for p in text.split(",") if p.strip()]


def compute_cpm(rows: pd.DataFrame):
    """Return (results DataFrame, project duration, critical path) or raise ValueError."""
    acts = {}
    for _, r in rows.iterrows():
        name = str(r["Activity"]).strip()
        if name in acts:
            raise ValueError(f"Duplicate activity ID: {name}")
        acts[name] = {"duration": float(r["Duration"]), "preds": parse_preds(r["Predecessors"])}

    for name, a in acts.items():
        for p in a["preds"]:
            if p not in acts:
                raise ValueError(f"Activity {name} has unknown predecessor: {p}")
            if p == name:
                raise ValueError(f"Activity {name} cannot be its own predecessor.")

    # Topological order (independent of the order activities were entered).
    order, done = [], set()
    while len(order) < len(acts):
        ready = [n for n in acts if n not in done and all(p in done for p in acts[n]["preds"])]
        if not ready:
            left = ", ".join(n for n in acts if n not in done)
            raise ValueError(f"Circular dependency among: {left}")
        for n in ready:
            order.append(n)
            done.add(n)

    for n in order:  # forward pass
        a = acts[n]
        a["ES"] = max((acts[p]["EF"] for p in a["preds"]), default=0)
        a["EF"] = a["ES"] + a["duration"]
    duration = max(a["EF"] for a in acts.values())

    for n in reversed(order):  # backward pass
        a = acts[n]
        succ = [acts[s]["LS"] for s in acts if n in acts[s]["preds"]]
        a["LF"] = min(succ, default=duration)
        a["LS"] = a["LF"] - a["duration"]
        a["Float"] = a["LS"] - a["ES"]

    result = pd.DataFrame(
        [[n, a["duration"], a["ES"], a["EF"], a["LS"], a["LF"], a["Float"]] for n, a in ((n, acts[n]) for n in order)],
        columns=["Activity", "Duration", "ES", "EF", "LS", "LF", "Float"],
    )
    critical = [n for n in order if abs(acts[n]["Float"]) < 1e-9]
    return result, duration, critical


if "activities" not in st.session_state:
    st.session_state.activities = pd.DataFrame(columns=COLUMNS)

with st.form("add_activity", clear_on_submit=True):
    c1, c2, c3 = st.columns(3)
    activity = c1.text_input("Activity ID")
    duration = c2.number_input("Duration (Days)", min_value=0.0, value=1.0)
    predecessors = c3.text_input("Predecessors", placeholder="A,B")
    submitted = st.form_submit_button("Add Activity")

if submitted:
    name = activity.strip()
    if not name:
        st.warning("Enter an Activity ID.")
    elif name in set(st.session_state.activities["Activity"]):
        st.warning(f"Activity {name} already exists.")
    else:
        st.session_state.activities = pd.concat(
            [st.session_state.activities, pd.DataFrame([[name, duration, predecessors.strip()]], columns=COLUMNS)],
            ignore_index=True,
        )

if st.session_state.activities.empty:
    st.info("No activities yet. Add one above.")
else:
    st.subheader("Activities")
    st.caption("Edit cells directly, or select rows and press Delete to remove them.")
    edited = st.data_editor(
        st.session_state.activities,
        num_rows="dynamic",
        hide_index=True,
        column_config={"Duration": st.column_config.NumberColumn(min_value=0.0)},
        key="activities_editor",
    )
    df = edited.dropna(subset=["Activity"]).copy()
    df = df[df["Activity"].astype(str).str.strip() != ""]
    df["Duration"] = pd.to_numeric(df["Duration"], errors="coerce").fillna(0.0)
    df["Predecessors"] = df["Predecessors"].fillna("")
    st.session_state.activities = df[COLUMNS].reset_index(drop=True)

    if st.button("Clear all activities"):
        st.session_state.activities = pd.DataFrame(columns=COLUMNS)
        st.rerun()

    try:
        result_df, project_duration, critical_path = compute_cpm(df)
    except ValueError as e:
        st.error(str(e))
    else:
        st.subheader("CPM Results")
        shown = result_df.assign(Critical=result_df["Float"].abs().lt(1e-9).map({True: "★", False: ""}))
        st.dataframe(shown, hide_index=True, use_container_width=True)
        st.metric("Project Duration", f"{project_duration:g} Days")
        st.error(f"Critical Path: {' → '.join(critical_path)}")
