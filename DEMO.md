# Local campaign manager demonstration

Use the tracked IBM CSV and manually enter example contact results. No messages are sent and no customer outreach is performed.

1. Copy `.env.example` to `.env`, replace the local database passwords, then run `make start`. In a second terminal run `make migrate`. Open <http://127.0.0.1:5173>.
2. Run `make seed-demo` to import any missing rows from the 7,043-row source CSV. The importer uses the app's validation and scoring API; repeating the command skips existing IDs. In the UI, inspect the import status and a customer's prediction history.
3. Create a campaign named `Internship retention review` with capacity `10`, value horizon `3` months, and cost per contacted customer `5` dataset currency units. These are illustrative assumptions.
4. Run optimization. Review the risk score, spending-derived value, and priority. Optionally exclude one recommendation with a reason and include another customer as a replacement. Confirm the final list. This creates an immutable selection snapshot; it does not contact anyone.
5. In the Outreach queue, record `Attempted` for one selected customer, `No answer` for another, and `Offer accepted` for a third. Add short notes. Open History to show that later entries do not erase earlier events.
6. Review the funnel and illustrative net value. The estimate is monthly charges of accepted-offer customers × 3 months, minus 5 units for each selected customer with a recorded outcome. An accepted offer is not proof of prevented churn.
7. Filter the queue, export the outreach CSV, then archive the campaign. Archived outcomes remain readable and cannot be changed. Return to Overview to show the aggregate funnel.

The chat page is optional and requires an API key. Local-only access is intentional for this internship demonstration; authentication is required before any real deployment.
