const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Permite requisições do frontend local (resolve o bloqueio de CORS)
app.use(cors());
app.use(express.json());

// Configuração da base de dados PostgreSQL utilizando a DATABASE_URL do .env
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// Teste inicial de ligação à base de dados
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Erro ao ligar à base de dados PostgreSQL:', err.stack);
    } else {
        console.log('✅ Ligação à base de dados PostgreSQL estabelecida com sucesso!');
        release();
    }
});

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ==========================================
// ROTAS DA API
// ==========================================

// Rota para submeter novas inscrições pelo frontend
app.post('/api/inscricoes', async (req, res) => {
    const { liga_id, nome_completo, matricula, email, telefone } = req.body;

    try {
        // 1. Guardar a inscrição na base de dados PostgreSQL
        const result = await pool.query(
            `INSERT INTO inscricoes (liga_id, nome_completo, matricula, email, telefone) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [liga_id, nome_completo, matricula, email, telefone]
        );

        console.log('✅ Inscrição guardada na base de dados:', result.rows[0]);

        // 2. Tentar enviar o e-mail de notificação (sem falhar a inscrição se o Gmail rejeitar)
        try {
            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: 'angeloenoc40@gmail.com',
                subject: `Nova Inscrição — Liga ${liga_id.toUpperCase()}`,
                text: `Nova candidatura recebida!\n\nNome: ${nome_completo}\nMatrícula: ${matricula}\nE-mail: ${email}\nTelefone: ${telefone}\nLiga: ${liga_id}`
            };

            await transporter.sendMail(mailOptions);
            console.log('✉️ E-mail de notificação enviado com sucesso!');
        } catch (emailErr) {
            console.warn('⚠️ A inscrição foi guardada no PostgreSQL, mas o e-mail não pôde ser enviado:', emailErr.message);
        }

        // 3. Responder sucesso ao frontend
        return res.status(201).json({
            sucesso: true,
            mensagem: 'Inscrição submetida com sucesso!',
            dados: result.rows[0]
        });

    } catch (dbErr) {
        console.error('❌ Erro na base de dados:', dbErr);
        return res.status(500).json({
            sucesso: false,
            erro: 'Erro interno ao guardar a inscrição na base de dados.'
        });
    }
});

// Rota para listar todas as inscrições (Painel Admin)
app.get('/api/admin/inscricoes', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM inscricoes ORDER BY data_inscricao DESC');
        return res.json({ sucesso: true, dados: result.rows });
    } catch (err) {
        console.error('❌ Erro ao procurar inscrições:', err);
        return res.status(500).json({ sucesso: false, erro: 'Erro ao carregar dados.' });
    }
});

// Rota para atualizar o estado da candidatura (Pendente -> Aprovado/Rejeitado)
app.patch('/api/admin/inscricoes/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado } = req.body; // 'Aprovado' ou 'Rejeitado'

    try {
        const result = await pool.query(
            'UPDATE inscricoes SET estado_candidatura = $1 WHERE id = $2 RETURNING *',
            [estado, id]
        );
        return res.json({ sucesso: true, mensagem: 'Estado atualizado!', dados: result.rows[0] });
    } catch (err) {
        console.error('❌ Erro ao atualizar estado:', err);
        return res.status(500).json({ sucesso: false, erro: 'Erro ao atualizar estado.' });
    }
});

// Iniciar o Servidor na porta definida no .env (3000)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor API do ISPOmbaka ativo e a escutar na porta ${PORT}`);
});