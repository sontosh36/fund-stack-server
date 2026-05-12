require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
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
    const usersCollection = database.collection("users");
    const loansCollection = database.collection("loans");
    const loanApplicationCollection = database.collection("loanApplication");

    // user management api
    app.post("/users", async (req, res) => {
      try {
        const { email, name, photoURL, role } = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email required" });
        }
        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.send({
            message: "User already exists",
            inserted: false,
          });
        }
        // Default role =borrower
        const newUser = {
          email,
          name,
          photoURL,
          role,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
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
        const { limit = 0, skip = 0, search = "" } = req.query;
        let query = {};
        if (search) {
          query.title = { $regex: search, $options: "i" };
        }
        const cursor = loansCollection
          .find(query)
          .sort({ createdAt: -1 })
          .project({ emiPlans: 0, createdBy: 0, requiredDocuments: 0 })
          .limit(Number(limit))
          .skip(Number(skip));
        const result = await cursor.toArray();
        const count = await loansCollection.countDocuments(query);
        res.send({ result, count });
      } catch (error) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    //loan details get api route
    app.get("/loan/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await loansCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Internal Server Error" });
      }
    });
    // loan application related api

    // borrower post loan application
    app.post("/loanApplication", async (req, res) => {
      try {
        const loan = req.body;
        loan.submitedAt = new Date();
        loan.applicationFeeStatus = "unpaid";
        loan.status = "pending";
        const result = await loanApplicationCollection.insertOne(loan);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    //borrower get loan application api
    app.get("/loanApplication", async (req, res) => {
      try {
        const { email } = req.query;
        const query = {};
        if (email) {
          query.borrowerEmail = email;
        }

        const cursor = loanApplicationCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // borrower loan application delete api
    app.delete("/loanApplication/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await loanApplicationCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // payment related api
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const paymentInfo = req.body;
        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: 1000,
                product_data: {
                  name: `Please pay for: ${paymentInfo.loanTitle}`,
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: paymentInfo.borrowerEmail,
          metadata: {
            application_id: paymentInfo.application_id,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });
        res.send({ url: session.url });
      } catch (err) {
        res.status(500).send({ message: "Internal Server Error" });
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
