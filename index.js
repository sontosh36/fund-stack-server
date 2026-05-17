require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const serviceAccount = require("./fund-stack-firebase-adminsdk.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers?.authorization;
  if (!token) {
    return res.send({ message: "Unauthorized access" });
  }
  try {
    const idToken = req.headers.authorization.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized access" });
  }
};
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
    const paymentCollection = database.collection("payments");

    // middleware more with database access
    const verifyAdmin = async(req, res, next)=>{
      const email = req.decoded_email;
      const query ={email}
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== 'admin' || user.role !== 'manager') {
        return res.status(403).send({message: 'forbidden access'})
      }
      next();
      
    }
    // user management api
    app.post("/users", async (req, res) => {
      try {
        const { email, name, photoURL } = req.body;
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
          role: "borrower",
          createdAt: new Date(),
        };

        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.get("/users/:email/role", async (req, res) => {
      try {
        const email = req.params.email;
        const query = { email };
        const user = await usersCollection.findOne(query);
        res.send({ role: user.role || "user" });
      } catch (error) {
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
    app.post("/loanApplication", verifyFBToken, async (req, res) => {
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
    app.get("/loanApplication", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;
        const query = {};
        if (email) {
          query.borrowerEmail = email;
          if (email !== req.decoded_email) {
            return res.status(403).send({ message: "forbidden access" });
          }
        }
        const cursor = loanApplicationCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // borrower loan application delete api
    app.delete("/loanApplication/:id", verifyFBToken, async (req, res) => {
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
            application_id: paymentInfo.application_Id,
            loanTitle: paymentInfo.loanTitle,
          },
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });
        res.send({ url: session.url });
      } catch (err) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // payment success api
    app.patch("/payment-success", async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
        const query = {
          transactionId: transactionId,
        };
        const alreadyPayment = await paymentCollection.findOne(query);
        if (alreadyPayment) {
          return res.send({ success: "false", message: "already Payment" });
        }

        if (session.payment_status === "paid") {
          const id = session.metadata.application_id;
          const query = { _id: new ObjectId(id) };
          const update = {
            $set: {
              applicationFeeStatus: "paid",
              transactionId: transactionId,
            },
          };
          const result = await loanApplicationCollection.updateOne(
            query,
            update,
          );
          const paymentData = {
            applicationId: session.metadata.application_id,
            transactionId: session.payment_intent,
            loanTitle: session.metadata.loanTitle,
            borrowerEmail: session.customer_email,
            paymentStatus: session.payment_status,
            paidAt: new Date(),
          };
          const resultPayment = await paymentCollection.insertOne(paymentData);
          res.send({
            success: true,
            modifyApplication: result,
            paymentInfo: resultPayment,
          });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // payment detalis api
    app.get("/payment-details/:loanId", async (req, res) => {
      try {
        const loanId = req.params.loanId;
        const query = {
          applicationId: loanId,
        };
        const result = await paymentCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // admin related api

    app.get("/users/borrowers", async (req, res) => {
      try {
        const cursor = usersCollection.find({ role: "borrower" });
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // get all loan api
    app.get("/all-loans/admin", async (req, res) => {
      try {
        const result = await loansCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // all loan delete api by admin
    app.delete("/allLoans/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await loansCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // all loan patch api
    app.patch("/allLoan/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateDoc = req.body;
        const update = {
          $set: {
            title: updateDoc.title,
            image: updateDoc.image,
            category: updateDoc.category,
            maxLoanLimit: updateDoc.maxLoanLimit,
            interestRate: updateDoc.interestRate,
          },
        };
        const result = await loansCollection.updateOne(query, update);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.patch("/show-on-home/loan/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const { showOnHome } = req.body;
        const updateToggle = {
          $set: {
            showOnHome,
          },
        };
        const result = await loansCollection.updateOne(query, updateToggle);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // all application see  get api
    app.get("/all-loan-application", async (req, res) => {
      try {
        const result = await loanApplicationCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // manager related api
    // add loan
    app.post("/add-loan", async (req, res) => {
      try {
        const data = req.body;
        data.createdAt = new Date();
        const result = await loansCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // manage loan get api
    app.get("/all-loan/:email/manageLoan", async (req, res) => {
      try {
        const email = req.params.email;
        const query = {};
        if (email) {
          query.email = email;
        }
        const cursor = loansCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // loan update api
    app.patch("/manage-loan/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateDoc = req.body;
        const update = {
          $set: {
            title: updateDoc.title,
            image: updateDoc.image,
            interestRate: updateDoc.interestRate,
            category: updateDoc.category,
            maxLoanLimit: updateDoc.maxLoanLimit,
            description: updateDoc.description,
          },
        };
        const result = await loansCollection.updateOne(query, update);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // load delete
    app.delete("/manageLoan/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await loansCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // get all pending Loan status
    app.get("/looking-pending-application", async (req, res) => {
      try {
        const result = await loanApplicationCollection
          .find({ status: "pending" })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // application status update(pending->approved) api
    app.patch("/pending-application/approved/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateStatus = {
          $set: {
            status: "approved",
            approvedAt: new Date(),
          },
        };
        const result = await loanApplicationCollection.updateOne(
          query,
          updateStatus,
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // application status update(pending->rejected) api
    app.patch("/pending-application/rejected/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updateInfo = {
          $set: {
            status: "rejected",
          },
        };
        const result = await loanApplicationCollection.updateOne(
          query,
          updateInfo,
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // approved loan application get
    app.get("/approved-loan", async (req, res) => {
      try {
        const result = await loanApplicationCollection
          .find({ status: "approved" })
          .toArray();
        res.send(result);
      } catch (error) {
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
