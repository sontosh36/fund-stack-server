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
