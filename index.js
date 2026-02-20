require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.l1sfp1m.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const database = client.db("fundStackDB");
    const loansCollection = database.collection("loans");

    // featured loan get api
    app.get("/featured-loans", async (req, res) => {
      try {
        const cursor = loansCollection
          .find({ showOnHome: true })
          .project({
            createdAt: 0,
            emiPlans: 0,
            requiredDocuments: 0,
            createdBy: 0,
          })
          .limit(6);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // all loans get api route
    app.get("/all-loans", async (req, res) => {
      try {
        const { limit = 0, skip = 0, search } = req.query;
        const query = {};
        if (search) {
          query.title = { $regex: search, $options: "i" };
        }
        const cursor = loansCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(Number(limit))
          .skip(Number(skip));
        const result = await cursor.toArray();
        const count = await loansCollection.countDocuments(query);
        res.send({ result, count });
      } catch (error) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // don't write
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("FundStack server content ready here!");
});

app.listen(port, () => {
  console.log(`FundStack server listening on port ${port}`);
});
